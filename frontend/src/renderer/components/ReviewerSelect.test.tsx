import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewerSelect } from "./ReviewerSelect";
import { agentReadiness } from "../test/agent-readiness-fixtures";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../lib/api-client", () => ({
  apiClient: {
    GET: getMock,
  },
  getApiBaseUrl: () => "http://127.0.0.1:3001",
  subscribeApiBaseUrl: () => () => {},
  apiErrorMessage: (_error: unknown, fallback = "Request failed") =>
    fallback,
}));

vi.mock("../lib/preview-mode", () => ({
  usesPreviewWorkspaceData: false,
}));

function renderReviewerSelect(agents?: Parameters<typeof ReviewerSelect>[0]["agents"]) {
  const onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ReviewerSelect
        value=""
        onChange={onChange}
        projectId="proj-1"
        defaultOptionLabel="Project default"
        ariaLabel="Default reviewer agent"
        agents={agents}
      />
    </QueryClientProvider>,
  );
  return { onChange };
}

function noModelCatalog() {
  getMock.mockImplementation(async (path: string) => {
    if (path === "/api/v1/agents/{agent}/models") {
      return {
        data: {
          agentId: "unknown",
          selectionMode: "text",
          models: [],
          allowCustom: false,
          source: "manual",
          fetchedAt: "2026-08-30T00:00:00Z",
          stale: false,
        },
        error: undefined,
      };
    }
    return { data: undefined };
  });
}

async function openReviewerMenu() {
  await userEvent.click(
    screen.getByRole("button", { name: "Default reviewer agent" }),
  );
}

describe("ReviewerSelect", () => {
  it("renders reviewer candidates from the daemon readiness snapshot", async () => {
    noModelCatalog();
    renderReviewerSelect([
      agentReadiness("pi"),
      agentReadiness("claude-code", "Claude Code", { installation: "not_installed" }),
    ]);

    await openReviewerMenu();

    const pi = await screen.findByRole("menuitem", { name: /^pi/i });
    expect(pi).toBeEnabled();
    // A daemon-uninstalled harness stays visible but is marked not selectable.
    const claude = screen.getByRole("menuitem", { name: /Claude Code/ });
    expect(claude).toHaveAttribute("aria-disabled", "true");
    expect(claude).toHaveTextContent("Needs install");
  });

  it("does not offer client-local fallback harnesses when the daemon snapshot is absent", async () => {
    noModelCatalog();
    renderReviewerSelect(undefined);

    await openReviewerMenu();

    // No daemon snapshot, no invented candidates: a remote daemon that only
    // runs pi must never be offered a harness detected on the client machine.
    expect(screen.queryByRole("menuitem", { name: /^Claude Code/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Codex/ })).not.toBeInTheDocument();
  });
});
