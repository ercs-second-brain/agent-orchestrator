import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSseRetryDelayMs } from "./sse-backoff";

const {
	onStatusMock,
	removeStatusMock,
	getApiBaseUrlMock,
	hasTrustedApiBaseUrlMock,
	subscribeApiBaseUrlMock,
	unsubscribeBaseUrlMock,
} = vi.hoisted(() => ({
	onStatusMock: vi.fn(),
	removeStatusMock: vi.fn(),
	getApiBaseUrlMock: vi.fn(() => "http://127.0.0.1:3001"),
	hasTrustedApiBaseUrlMock: vi.fn(() => true),
	subscribeApiBaseUrlMock: vi.fn(),
	unsubscribeBaseUrlMock: vi.fn(),
}));

vi.mock("./bridge", () => ({
	aoBridge: {
		daemon: { onStatus: onStatusMock },
	},
}));

vi.mock("./api-client", () => ({
	getApiBaseUrl: getApiBaseUrlMock,
	hasTrustedApiBaseUrl: hasTrustedApiBaseUrlMock,
	subscribeApiBaseUrl: subscribeApiBaseUrlMock,
}));

import { createEventTransport } from "./event-transport";
import { getEventsConnectionState, setEventsConnectionState } from "./events-connection";

class EventSourceStub {
	static instances: EventSourceStub[] = [];
	url: string;
	closed = false;
	readyState = 0; // CONNECTING
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: (() => void) | null = null;
	listeners: string[] = [];
	handlers = new Map<string, (event: Event) => void>();
	constructor(url: string) {
		this.url = url;
		EventSourceStub.instances.push(this);
	}
	addEventListener(type: string, listener: (event: Event) => void) {
		this.listeners.push(type);
		this.handlers.set(type, listener);
	}
	emit(type: string, data: string) {
		this.handlers.get(type)?.({ data } as unknown as Event);
	}
	close() {
		this.closed = true;
		this.readyState = 2; // CLOSED
	}
}

function fakeQueryClient() {
	return {
		invalidateQueries: vi.fn(),
		refetchQueries: vi.fn().mockResolvedValue(undefined),
		setQueryData: vi.fn(),
	} as unknown as Parameters<typeof createEventTransport>[0];
}

function cdcSources() {
	return EventSourceStub.instances.filter((source) => source.url.endsWith("/api/v1/events"));
}

beforeEach(() => {
	EventSourceStub.instances = [];
	onStatusMock.mockReset().mockReturnValue(removeStatusMock);
	removeStatusMock.mockReset();
	getApiBaseUrlMock.mockReset().mockReturnValue("http://127.0.0.1:3001");
	hasTrustedApiBaseUrlMock.mockReset().mockReturnValue(true);
	subscribeApiBaseUrlMock.mockReset().mockReturnValue(unsubscribeBaseUrlMock);
	unsubscribeBaseUrlMock.mockReset();
	setEventsConnectionState("idle");
	(globalThis as unknown as { EventSource: unknown }).EventSource = EventSourceStub;
});

afterEach(() => {
	delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
});

describe("createEventTransport", () => {
	it("opens the CDC SSE connection on connect", () => {
		createEventTransport(fakeQueryClient()).connect();
		expect(EventSourceStub.instances).toHaveLength(1);
		expect(EventSourceStub.instances[0].url).toBe("http://127.0.0.1:3001/api/v1/events");
	});



	it("does not reconnect when a daemon status keeps the same base URL", () => {
		createEventTransport(fakeQueryClient()).connect();
		const onStatusHandler = onStatusMock.mock.calls[0][0] as () => void;

		onStatusHandler();

		expect(EventSourceStub.instances).toHaveLength(1);
	});

	it("closes the old connection and reconnects when the base URL changes", () => {
		createEventTransport(fakeQueryClient()).connect();
		const first = cdcSources()[0];
		const onStatusHandler = onStatusMock.mock.calls[0][0] as () => void;

		getApiBaseUrlMock.mockReturnValue("http://127.0.0.1:3099");
		onStatusHandler();

		expect(first.closed).toBe(true);
		expect(EventSourceStub.instances).toHaveLength(2);
		expect(EventSourceStub.instances[1].url).toBe("http://127.0.0.1:3099/api/v1/events");
	});

	it("does not make a new daemon port serve the dead port's backoff delay", () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		createEventTransport(fakeQueryClient()).connect();
		const onStatusHandler = onStatusMock.mock.calls[0][0] as () => void;

		// Fail the old port repeatedly so the delay grows well past the initial step.
		for (let failure = 1; failure <= 4; failure += 1) {
			const source = EventSourceStub.instances.at(-1)!;
			source.readyState = 2;
			source.onerror?.();
			vi.advanceTimersByTime(computeSseRetryDelayMs(failure, () => 0.5));
		}
		const beforeCdcMove = cdcSources().length;

		// The daemon comes back on a different port: a fresh target.
		getApiBaseUrlMock.mockReturnValue("http://127.0.0.1:3099");
		onStatusHandler();
		expect(cdcSources()).toHaveLength(beforeCdcMove + 1);

		const moved = cdcSources().at(-1)!;
		moved.readyState = 2;
		moved.onerror?.();
		const firstRetryMs = computeSseRetryDelayMs(1, () => 0.5);
		const beforeRetry = EventSourceStub.instances.length;
		vi.advanceTimersByTime(firstRetryMs - 1);
		expect(EventSourceStub.instances).toHaveLength(beforeRetry);
		vi.advanceTimersByTime(1);
		expect(EventSourceStub.instances).toHaveLength(beforeRetry + 1);
		vi.useRealTimers();
	});

	it("closes the source and skips reconnecting when the base URL is untrusted", () => {
		createEventTransport(fakeQueryClient()).connect();
		const first = cdcSources()[0];
		const onStatusHandler = onStatusMock.mock.calls[0][0] as () => void;

		hasTrustedApiBaseUrlMock.mockReturnValue(false);
		onStatusHandler();

		expect(first.closed).toBe(true);
		expect(EventSourceStub.instances).toHaveLength(1);
		expect(getEventsConnectionState()).toBe("disconnected");
		void 0;
	});

	it("debounces workspace and session invalidation after a status change", () => {
		vi.useFakeTimers();
		try {
			const queryClient = fakeQueryClient();
			createEventTransport(queryClient).connect();
			const onStatusHandler = onStatusMock.mock.calls[0][0] as () => void;

			onStatusHandler();
			expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
			vi.advanceTimersByTime(200);
			expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["workspaces"] });
			expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["session-scm-summary"] });
			expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["session-usage"] });
		} finally {
			vi.useRealTimers();
		}
	});



	it("tears down the source and the daemon listener on disconnect", () => {
		const disconnect = createEventTransport(fakeQueryClient()).connect();

		disconnect();

		expect(cdcSources()[0].closed).toBe(true);
		expect(removeStatusMock).toHaveBeenCalledTimes(1);
	});

	it("is a no-op when EventSource is unavailable", () => {
		delete (globalThis as unknown as { EventSource?: unknown }).EventSource;

		expect(() => createEventTransport(fakeQueryClient()).connect()).not.toThrow();
		expect(EventSourceStub.instances).toHaveLength(0);
	});

	it("marks the stream connected on open and disconnected on error", () => {
		createEventTransport(fakeQueryClient()).connect();
		const source = cdcSources()[0];

		source.readyState = 1; // OPEN
		source.onopen?.();
		expect(getEventsConnectionState()).toBe("connected");

		source.readyState = 0; // CONNECTING — browser is auto-retrying
		source.onerror?.();
		expect(getEventsConnectionState()).toBe("disconnected");

		source.readyState = 1;
		source.onopen?.();
		expect(getEventsConnectionState()).toBe("connected");
	});

	it("reports transport unhealthy only when the post-disconnect full refresh also fails", async () => {
		const queryClient = fakeQueryClient() as unknown as { refetchQueries: ReturnType<typeof vi.fn> };
		queryClient.refetchQueries = vi.fn().mockRejectedValue(new Error("refresh failed"));
		createEventTransport(queryClient as never).connect();
		const source = cdcSources()[0];
		source.onerror?.();
		await Promise.resolve(); await Promise.resolve();
	});

	it("heals transport when the post-disconnect full refresh succeeds", async () => {
		const queryClient = fakeQueryClient() as unknown as { refetchQueries: ReturnType<typeof vi.fn> };
		queryClient.refetchQueries = vi.fn().mockResolvedValue(undefined);
		createEventTransport(queryClient as never).connect();
		cdcSources()[0].onerror?.();
		await Promise.resolve(); await Promise.resolve();
	});

	it("ignores a stale failed refresh after the SSE source reconnects", async () => {
		let rejectRefresh: (error: Error) => void = () => undefined;
		const queryClient = fakeQueryClient() as unknown as { refetchQueries: ReturnType<typeof vi.fn> };
		queryClient.refetchQueries = vi.fn().mockReturnValue(new Promise<void>((_resolve, reject) => { rejectRefresh = reject; }));
		createEventTransport(queryClient as never).connect();
		const source = cdcSources()[0];
		source.onerror?.();
		source.onopen?.();
		rejectRefresh(new Error("late failure"));
		await Promise.resolve(); await Promise.resolve();
	});

	it("rebuilds a source the browser abandoned after the retry delay", () => {
		vi.useFakeTimers();
		try {
			createEventTransport(fakeQueryClient()).connect();
			const source = cdcSources()[0];

			source.readyState = 2; // CLOSED — EventSource gave up for good
			source.onerror?.();

			expect(cdcSources()).toHaveLength(1);
			vi.advanceTimersByTime(5_000);
			expect(EventSourceStub.instances).toHaveLength(2);
			expect(EventSourceStub.instances[1].url).toBe("http://127.0.0.1:3001/api/v1/events");
		} finally {
			vi.useRealTimers();
		}
	});

	it("reconnects when the API base URL changes out-of-band", () => {
		createEventTransport(fakeQueryClient()).connect();
		expect(subscribeApiBaseUrlMock).toHaveBeenCalledTimes(1);
		const onBaseUrlChange = subscribeApiBaseUrlMock.mock.calls[0][0] as () => void;
		const first = cdcSources()[0];

		getApiBaseUrlMock.mockReturnValue("http://127.0.0.1:4555");
		onBaseUrlChange();

		expect(first.closed).toBe(true);
		expect(EventSourceStub.instances).toHaveLength(2);
		expect(EventSourceStub.instances[1].url).toBe("http://127.0.0.1:4555/api/v1/events");
	});

	it("resets the connection state and unsubscribes on disconnect", () => {
		const disconnect = createEventTransport(fakeQueryClient()).connect();
		const source = cdcSources()[0];
		source.readyState = 1;
		source.onopen?.();
		expect(getEventsConnectionState()).toBe("connected");

		disconnect();

		expect(getEventsConnectionState()).toBe("idle");
		expect(unsubscribeBaseUrlMock).toHaveBeenCalledTimes(1);
	});
});
