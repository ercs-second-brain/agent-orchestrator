import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
	default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock("expo-secure-store", () => ({
	getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(),
}));

import { DEFAULT_CONFIG, type ServerConfig } from "./config";
import { DIRECT_POLL_MS, pollIntervalFor, TUNNEL_POLL_MS } from "./pollInterval";

const cfg = (over: Partial<ServerConfig> = {}): ServerConfig => ({
	...DEFAULT_CONFIG, host: "192.168.1.42", httpPort: "3011", password: "pw", ...over,
});

describe("pollIntervalFor", () => {
	// Measured: a Cloudflare quick tunnel forwards bodies in ~128 KB chunks, so
	// small live frames never get through promptly. Polling is the only thing
	// that moves the UI, so on that path it has to be quick enough to feel live.
	it("polls quickly over the tunnel, the one path that cannot deliver small frames", () => {
		expect(pollIntervalFor(cfg({ endpointKind: "tunnel" }))).toBe(TUNNEL_POLL_MS);
		expect(TUNNEL_POLL_MS).toBeLessThan(DIRECT_POLL_MS);
	});

	// Direct paths carry small frames fine, so the poll stays cheap on battery
	// and data.
	it.each(["lan", "tailscale"] as const)("keeps the normal interval over %s", (kind) => {
		expect(pollIntervalFor(cfg({ endpointKind: kind }))).toBe(DIRECT_POLL_MS);
	});

	// A pairing made before this field existed, or a config restored from
	// storage without it, must not silently start polling every couple of
	// seconds forever.
	it("keeps the normal interval when the endpoint kind is unknown", () => {
		expect(pollIntervalFor(cfg({ endpointKind: undefined }))).toBe(DIRECT_POLL_MS);
		expect(pollIntervalFor(null)).toBe(DIRECT_POLL_MS);
	});
});
