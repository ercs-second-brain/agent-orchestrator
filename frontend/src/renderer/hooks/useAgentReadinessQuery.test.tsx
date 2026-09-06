import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentReadiness } from "../test/agent-readiness-fixtures";

const { getMock, postMock } = vi.hoisted(() => ({
	getMock: vi.fn(),
	postMock: vi.fn(),
}));

vi.mock("../lib/api-client", () => ({
	getApiBaseUrl: () => "",
	subscribeApiBaseUrl: () => () => undefined,
	apiClient: { GET: getMock, POST: postMock },
	apiErrorMessage: () => "request failed",
}));

import {
	agentReadinessQueryOptions,
	agentReadinessQueryKey,
	mergeAgentReadiness,
	useAgentReadinessQuery,
	useEnsureAgentReadiness,
} from "./useAgentReadinessQuery";

function wrapper(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

beforeEach(() => {
	getMock.mockReset().mockResolvedValue({
		data: { agents: [agentReadiness("pi")] },
		error: undefined,
	});
	postMock.mockReset().mockResolvedValue({
		data: { agents: [agentReadiness("pi")] },
		error: undefined,
	});
});

describe("agent readiness query", () => {
	it("leaves freshness policy to the daemon", () => {
		expect(agentReadinessQueryOptions.staleTime).toBe(Number.POSITIVE_INFINITY);
	});

	it("fetches readiness through the ensure endpoint", async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result } = renderHook(() => useAgentReadinessQuery(), { wrapper: wrapper(queryClient) });

		await waitFor(() => expect(result.current.data?.agents[0]?.id).toBe("pi"));
		expect(getMock).not.toHaveBeenCalled();
	});

	it("deduplicates pi in the ensure request", async () => {
		const queryClient = new QueryClient();
		renderHook(
			() => useEnsureAgentReadiness({ agentIds: ["pi", "pi"] }),
			{ wrapper: wrapper(queryClient) },
		);

		await waitFor(() =>
			expect(postMock).toHaveBeenCalledWith("/api/v1/agents/readiness/ensure", {
				body: { agentIds: ["pi"], purpose: "display" },
			}),
		);
		expect(queryClient.getQueryData(agentReadinessQueryKey)).toEqual({
			agents: [agentReadiness("pi")],
		});
	});

	it("merges targeted ensures without discarding distinct snapshots", () => {
		const checkedPi = agentReadiness("pi", "pi", { usageCount: 2 });
		const freshPi = agentReadiness("pi");

		// Distinct ids pass through; same-id snapshots overwrite.
		const worker = agentReadiness("worker");
		expect(mergeAgentReadiness({ agents: [checkedPi, worker] }, { agents: [freshPi] })).toEqual({
			agents: [freshPi, worker],
		});
	});
});
