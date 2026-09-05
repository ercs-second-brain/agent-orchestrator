import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HarnessSettingsSection } from "./HarnessSettingsSection";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../../lib/api-client", () => ({
	apiClient: { GET: getMock },
	apiErrorCode: (_e: unknown, f = "error") => f,
	apiErrorMessage: (_e: unknown, f = "Request failed") => f,
	getApiBaseUrl: () => "http://127.0.0.1:3001",
}));

const catalog = {
	data: {
		agents: [{ id: "pi", label: "pi" }],
	},
	error: undefined,
};

const plans = {
	agents: [
		{
			agentId: "pi", available: true, automatic: true, method: "npm",
			command: "npm install -g @earendil-works/pi-coding-agent", documentationUrl: "https://github.com/earendil-works/pi",
			methods: [{ id: "npm", label: "npm", available: true, recommended: true, command: "npm install -g @earendil-works/pi-coding-agent", reinstallAvailable: true, reinstallCommand: "npm install -g @earendil-works/pi-coding-agent" }],
		},
	],
};

describe("HarnessSettingsSection", () => {
	afterEach(() => vi.restoreAllMocks());

	it("surfaces install job polling failures", async () => {
		getMock.mockImplementation(async (path: string) => {
			if (path === "/api/v1/agents/readiness/ensure") return catalog;
			if (path === "/api/v1/agents/installers") return { data: plans, error: undefined };
			if (path === "/api/v1/agents/install-jobs") return { error: { error: { message: "Could not poll installation status." } } };
			return { data: undefined, error: undefined };
		});

		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<HarnessSettingsSection titleHidden />
			</QueryClientProvider>,
		);

		expect(await screen.findByText(/Could not (poll|load harness installation)/)).toBeInTheDocument();
	});
});
