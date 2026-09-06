import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { WorkspaceSummary } from "../types/workspace";

const {
	getApiBaseUrlMock,
	getMock,
	hasTrustedApiBaseUrlMock,
	subscribeApiBaseUrlMock,
} = vi.hoisted(() => ({
	getApiBaseUrlMock: vi.fn(() => "http://127.0.0.1:3001"),
	getMock: vi.fn(),
	hasTrustedApiBaseUrlMock: vi.fn(() => true),
	subscribeApiBaseUrlMock: vi.fn(() => () => undefined),
}));

vi.mock("../lib/api-client", () => ({
	apiClient: { GET: getMock },
	getApiBaseUrl: getApiBaseUrlMock,
	hasTrustedApiBaseUrl: hasTrustedApiBaseUrlMock,
	subscribeApiBaseUrl: subscribeApiBaseUrlMock,
}));


import { useWorkspaceQuery, useWorkspaceSession, useWorkspaceTraySessions, workspaceQueryKey } from "./useWorkspaceQuery";

function wrapper({ children }: { children: ReactNode }) {
	// The hook pins its own retry policy; retryDelay 0 keeps the error tests fast.
	const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function respondWith(payload: {
	projects?: { data?: unknown; error?: unknown };
	sessions?: { data?: unknown; error?: unknown };
}) {
	getMock.mockImplementation(async (url: string) => {
		if (url === "/api/v1/projects") return payload.projects ?? { data: { projects: [] }, error: undefined };
		if (url === "/api/v1/sessions") return payload.sessions ?? { data: { sessions: [] }, error: undefined };
		throw new Error(`unexpected GET ${url}`);
	});
}

beforeEach(() => {
	getMock.mockReset();
	getApiBaseUrlMock.mockReset().mockReturnValue("http://127.0.0.1:3001");
	hasTrustedApiBaseUrlMock.mockReset().mockReturnValue(true);
	subscribeApiBaseUrlMock.mockReset().mockReturnValue(() => undefined);
});

describe("useWorkspaceQuery", () => {
	it("does not fetch workspaces while the daemon base URL is untrusted", async () => {
		getApiBaseUrlMock.mockReturnValue("");

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });

		await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
		expect(getMock).not.toHaveBeenCalled();
	});

	it("maps projects and their sessions, applying provider/status/title fallbacks", async () => {
		respondWith({
			projects: {
				data: {
					projects: [
						{
							id: "proj-1",
							name: "my-app",
							path: "/home/me/my-app",
							orchestratorAgent: "pi",
						},
					],
				},
				error: undefined,
			},
			sessions: {
				data: {
					sessions: [
						{
							id: "sess-1",
							projectId: "proj-1",
							terminalHandleId: "term-1",
							terminalGeneration: "launch-2",
							displayName: "fix-bug",
							issueId: "github:acme/project-one#42",
							harness: "claude-code",
							reviewerHarness: "qwen",
							branch: "qa/modal-worker",
							status: "mergeable",
							scmStatus: "review_pending",
							kanbanColumn: "ready",
							displayStatus: "Mergeable",
							isTerminated: false,
							autoInjectReview: false,
							autoInjectCI: false,
							activity: { state: "idle", lastActivityAt: "2026-06-10T15:30:00Z" },
							lastUserMessageAt: "2026-06-10T16:10:00Z",
							updatedAt: "2026-06-10T16:15:04Z",
						},
						{
							// Unknown harness/status and no displayName/issueId: falls back
							// to codex / unknown / the session id.
							id: "sess-2",
							projectId: "proj-1",
							harness: "legacy-harness",
							reviewerHarness: "mystery-reviewer",
							status: "bogus",
							isTerminated: false,
							updatedAt: "2026-06-10T16:15:04Z",
						},
						// Belongs to another project; must not leak into proj-1.
						{ id: "sess-3", projectId: "proj-2", isTerminated: false, updatedAt: "2026-06-10T16:15:04Z" },
					],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		const [workspace] = result.current.data ?? [];
		expect(workspace).toMatchObject({
			id: "proj-1",
			name: "my-app",
			path: "/home/me/my-app",
			orchestratorAgent: "pi",
		});
		expect(workspace.sessions).toHaveLength(2);
		expect(workspace.sessions[0]).toMatchObject({
			id: "sess-1",
			terminalHandleId: "term-1",
			terminalGeneration: "launch-2",
			title: "fix-bug",
			issueId: "github:acme/project-one#42",
			provider: "pi",
			reviewerHarness: undefined,
			branch: "qa/modal-worker",
			status: "mergeable",
			scmStatus: "review_pending",
			kanbanColumn: "ready",
			displayStatus: "Mergeable",
			activity: { state: "idle", lastActivityAt: "2026-06-10T15:30:00Z" },
			lastUserMessageAt: "2026-06-10T16:10:00Z",
			autoInjectReview: false,
			autoInjectCI: false,
		});
		expect(workspace.sessions[1]).toMatchObject({
			id: "sess-2",
			title: "sess-2",
			provider: "pi",
			reviewerHarness: undefined,
			status: "unknown",
			branch: undefined,
			autoInjectReview: true,
			autoInjectCI: true,
		});
	});

	it("defaults auto review to enabled when the daemon omits the session flag", async () => {
		respondWith({
			sessions: {
				data: {
					sessions: [
						{
							id: "sess-legacy",
							projectId: "proj-1",
							harness: "pi",
							status: "working",
							isTerminated: false,
							updatedAt: "2026-06-10T16:15:04Z",
						},
					],
				},
				error: undefined,
			},
			projects: {
				data: {
					projects: [{ id: "proj-1", name: "my-app", path: "/home/me/my-app", orchestratorAgent: "pi" }],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		const [workspace] = result.current.data ?? [];
		expect(workspace.sessions[0].autoReviewEnabled).toBe(true);
	});

	it("respects an explicit autoReviewEnabled=false from the daemon", async () => {
		respondWith({
			sessions: {
				data: {
					sessions: [
						{
							id: "sess-off",
							projectId: "proj-1",
							harness: "pi",
							status: "working",
							autoReviewEnabled: false,
							isTerminated: false,
							updatedAt: "2026-06-10T16:15:04Z",
						},
					],
				},
				error: undefined,
			},
			projects: {
				data: {
					projects: [{ id: "proj-1", name: "my-app", path: "/home/me/my-app", orchestratorAgent: "pi" }],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		const [workspace] = result.current.data ?? [];
		expect(workspace.sessions[0].autoReviewEnabled).toBe(false);
	});
	it("preserves scratch projects and leaves branchless scratch sessions branchless", async () => {
		respondWith({
			projects: {
				data: {
					projects: [
						{
							id: "scratch",
							name: "Scratch",
							kind: "scratch",
							path: "/home/me/.ao/scratch/default",
						},
					],
				},
				error: undefined,
			},
			sessions: {
				data: {
					sessions: [
						{
							id: "scratch-worker-1",
							projectId: "scratch",
							harness: "pi",
							status: "working",
							isTerminated: false,
							updatedAt: "2026-06-10T16:15:04Z",
						},
					],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(result.current.data?.[0]).toMatchObject({
			id: "scratch",
			kind: "scratch",
		});
		expect(result.current.data?.[0].sessions[0]).toMatchObject({
			id: "scratch-worker-1",
			branch: undefined,
		});
	});

	it("stays loading when the routed session is missing from a cached workspace list", async () => {
		let finishGet: ((value: { data: { session: Record<string, unknown> }; error: undefined }) => void) | undefined;
		getMock.mockImplementation(async (url: string, options?: { params?: { path?: { sessionId?: string } } }) => {
			if (url === "/api/v1/projects") {
				return {
					data: { projects: [{ id: "proj-1", name: "workspace3", path: "/tmp/workspace3" }] },
					error: undefined,
				};
			}
			if (url === "/api/v1/sessions") {
				return { data: { sessions: [] }, error: undefined };
			}
			if (url === "/api/v1/sessions/{sessionId}") {
				expect(options?.params?.path?.sessionId).toBe("sess-orch");
				return await new Promise((resolve) => {
					finishGet = resolve;
				});
			}
			throw new Error(`unexpected GET ${url}`);
		});

		const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
		const localWrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const { result } = renderHook(() => useWorkspaceSession("sess-orch"), { wrapper: localWrapper });

		await waitFor(() => expect(result.current.isLoading).toBe(true));
		expect(result.current.data).toBeUndefined();
		expect(finishGet).toBeTypeOf("function");
		finishGet?.({
			data: {
				session: {
					id: "sess-orch",
					projectId: "proj-1",
					displayName: "orchestrate",
					harness: "pi",
					kind: "orchestrator",
					mode: "tui",
					status: "working",
					kanbanColumn: "building",
					displayStatus: "Working",
					autoInjectReview: true,
					autoInjectCI: true,
					autoReviewEnabled: false,
					isPinned: false,
					isTerminated: false,
					terminateOnPrMerge: false,
					prs: [],
					activity: { state: "idle", lastActivityAt: "2026-09-04T10:00:00Z" },
					createdAt: "2026-09-04T10:00:00Z",
					updatedAt: "2026-09-04T10:00:01Z",
				},
			},
			error: undefined,
		});
		await waitFor(() => expect(result.current.data?.id).toBe("sess-orch"));
		expect(result.current.isLoading).toBe(false);
	});

	it("falls back to the direct session read while the workspace list has not caught up", async () => {
		getMock.mockImplementation(async (url: string, options?: { params?: { path?: { sessionId?: string } } }) => {
			if (url === "/api/v1/projects") {
				return {
					data: {
						projects: [{ id: "proj-1", name: "workspace3", path: "/tmp/workspace3", orchestratorAgent: "pi" }],
					},
					error: undefined,
				};
			}
			if (url === "/api/v1/sessions") {
				return { data: { sessions: [] }, error: undefined };
			}
			if (url === "/api/v1/sessions/{sessionId}") {
				expect(options?.params?.path?.sessionId).toBe("sess-orch");
				return {
					data: {
						session: {
							id: "sess-orch",
							projectId: "proj-1",
							displayName: "orchestrate",
							harness: "pi",
							kind: "orchestrator",
							mode: "tui",
							status: "working",
							kanbanColumn: "building",
							displayStatus: "Working",
							autoInjectReview: true,
							autoInjectCI: true,
							autoReviewEnabled: false,
							isPinned: false,
							isTerminated: false,
							terminateOnPrMerge: false,
							prs: [],
							activity: { state: "idle", lastActivityAt: "2026-09-04T10:00:00Z" },
							createdAt: "2026-09-04T10:00:00Z",
							updatedAt: "2026-09-04T10:00:01Z",
						},
					},
					error: undefined,
				};
			}
			throw new Error(`unexpected GET ${url}`);
		});

		const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
		const localWrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);

		const { result } = renderHook(() => useWorkspaceSession("sess-orch"), { wrapper: localWrapper });

		await waitFor(() => expect(result.current.data?.id).toBe("sess-orch"));
		expect(result.current.data).toMatchObject({
			id: "sess-orch",
			workspaceId: "proj-1",
			workspaceName: "workspace3",
			title: "orchestrate",
			provider: "pi",
			kind: "orchestrator",
		});
		await waitFor(() => {
			const cached = queryClient.getQueryData<WorkspaceSummary[]>([...workspaceQueryKey, "http://127.0.0.1:3001"]);
			expect(Array.isArray(cached)).toBe(true);
			expect(cached?.[0]?.sessions.some((session: { id: string }) => session.id === "sess-orch")).toBe(true);
		});
	});

	it("maps each session's prs straight from the session list", async () => {
		respondWith({
			projects: { data: { projects: [{ id: "proj-1", name: "my-app", path: "/p" }] }, error: undefined },
			sessions: {
				data: {
					sessions: [
						{
							id: "sess-1",
							projectId: "proj-1",
							status: "pr_open",
							isTerminated: false,
							updatedAt: "2026-06-10T16:15:04Z",
							prs: [
								{
									number: 278,
									state: "open",
									url: "u",
									ci: "passing",
									review: "approved",
									mergeability: "clean",
									reviewComments: false,
									updatedAt: "2026-06-10T16:15:04Z",
								},
							],
						},
						{
							id: "sess-2",
							projectId: "proj-1",
							status: "working",
							isTerminated: false,
							updatedAt: "2026-06-10T16:15:04Z",
						},
					],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		const sessions = result.current.data?.[0].sessions ?? [];
		expect(sessions[0].prs).toEqual([
			{
				number: 278,
				state: "open",
				url: "u",
				ci: "passing",
				review: "approved",
				mergeability: "clean",
				reviewComments: false,
				updatedAt: "2026-06-10T16:15:04Z",
			},
		]);
		// A session with no PRs maps to an empty stack, so the empty states render.
		expect(sessions[1].prs).toEqual([]);
	});

	it("preserves backend merged status for terminated merged sessions", async () => {
		respondWith({
			projects: { data: { projects: [{ id: "proj-1", name: "my-app", path: "/p" }] }, error: undefined },
			sessions: {
				data: {
					sessions: [
						{
							id: "sess-1",
							projectId: "proj-1",
							status: "merged",
							isTerminated: true,
							updatedAt: "2026-06-10T16:15:04Z",
						},
					],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(result.current.data?.[0].sessions[0].status).toBe("merged");
		expect(result.current.data?.[0].sessions[0].isTerminated).toBe(true);
	});

	it("falls back to terminated for terminated sessions without a known backend status", async () => {
		respondWith({
			projects: { data: { projects: [{ id: "proj-1", name: "my-app", path: "/p" }] }, error: undefined },
			sessions: {
				data: {
					sessions: [
						{
							id: "sess-1",
							projectId: "proj-1",
							status: "bogus",
							isTerminated: true,
							updatedAt: "2026-06-10T16:15:04Z",
						},
					],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(result.current.data?.[0].sessions[0].status).toBe("terminated");
		expect(result.current.data?.[0].sessions[0].isTerminated).toBe(true);
	});

	it("surfaces a projects fetch error", async () => {
		const failure = new TypeError("Failed to fetch");
		respondWith({ projects: { data: undefined, error: failure } });

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });

		await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3_000 });
		expect(result.current.error).toBe(failure);
	});

	it("surfaces a sessions fetch error even when projects load", async () => {
		const failure = new Error("sessions backend down");
		respondWith({
			projects: { data: { projects: [{ id: "proj-1", name: "my-app", path: "/p" }] }, error: undefined },
			sessions: { data: undefined, error: failure },
		});

		const { result } = renderHook(() => useWorkspaceQuery(), { wrapper });

		await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3_000 });
		expect(result.current.error).toBe(failure);
	});

	it("selects only attention-worthy worker sessions for the always-mounted tray", async () => {
		respondWith({
			projects: { data: { projects: [{ id: "proj-1", name: "my-app", path: "/p" }] }, error: undefined },
			sessions: {
				data: {
					sessions: [
						{ id: "needs-input", projectId: "proj-1", displayName: "Needs input", harness: "pi", status: "needs_input", updatedAt: "2026-08-01T00:00:00Z" },
						{ id: "mergeable", projectId: "proj-1", displayName: "Mergeable", harness: "pi", status: "mergeable", updatedAt: "2026-08-01T00:00:00Z" },
						{ id: "working", projectId: "proj-1", displayName: "Working", harness: "pi", status: "working", updatedAt: "2026-08-01T00:00:00Z" },
						{ id: "merged", projectId: "proj-1", displayName: "Merged", harness: "pi", status: "merged", updatedAt: "2026-08-01T00:00:00Z" },
						{ id: "orchestrator", projectId: "proj-1", displayName: "Orchestrator", harness: "pi", kind: "orchestrator", status: "needs_input", updatedAt: "2026-08-01T00:00:00Z" },
					],
				},
				error: undefined,
			},
		});

		const { result } = renderHook(() => useWorkspaceTraySessions(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([
			{ projectId: "proj-1", projectName: "my-app", sessionId: "needs-input", title: "Needs input", zone: "action" },
			{ projectId: "proj-1", projectName: "my-app", sessionId: "mergeable", title: "Mergeable", zone: "merge" },
		]);
	});
});
