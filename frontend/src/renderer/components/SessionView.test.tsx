import { StrictMode, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionView } from "./SessionView";
import { SessionTopbarProvider } from "./SessionTopbarPortal";
import { TooltipProvider } from "./ui/tooltip";
import { useUiStore, type InspectorView } from "../stores/ui-store";
import type { WorkspaceSession, WorkspaceSummary } from "../types/workspace";

const navigateMock = vi.hoisted(() => vi.fn());
const openShellTerminalMock = vi.hoisted(() => vi.fn());
const closeShellTerminalMock = vi.hoisted(() => vi.fn());
const nativeFullScreenMock = vi.hoisted(() => vi.fn(() => false));
const reviewGetMock = vi.hoisted(() => vi.fn());
const inspectorVisibilityRenders = vi.hoisted(() => [] as boolean[]);
const codexAccountsQueryState = vi.hoisted(() => ({ data: undefined as unknown }));
const recoverCodexAccountSwitchMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("../lib/platform", () => ({
	// Exercise the macOS shell layout without changing the existing Ctrl-based
	// shortcut assertions in this suite.
	hidesShellTopbar: () => true,
	isMacPlatform: () => false,
}));
vi.mock("../hooks/useWindowFullScreen", () => ({
	useWindowFullScreen: () => nativeFullScreenMock(),
}));
vi.mock("../hooks/useCodexAccountsQuery", () => ({
	useCodexAccountsQuery: () => ({ data: codexAccountsQueryState.data, isLoading: false }),
}));

vi.mock("../hooks/useCodexAccountActions", () => ({
	useCodexAccountActions: () => ({
		error: null,
		recoverPending: false,
		recoverSwitch: recoverCodexAccountSwitchMock,
	}),
}));

vi.mock("../lib/api-client", () => ({
	getApiBaseUrl: () => "",
	subscribeApiBaseUrl: () => () => undefined,
	apiClient: {
		GET: reviewGetMock,
	},
	apiErrorCode: (error: { code?: string }) => error.code,
	apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

const { workspaces, workspaceQueryState, shellTerminalsState } = vi.hoisted(() => {
	const worker = {
		id: "sess-1",
		workspaceId: "proj-1",
		workspaceName: "my-app",
		title: "do the thing",
		provider: "claude-code",
		kind: "worker",
		branch: "ao/sess-1",
		status: "working",
		updatedAt: "2026-06-10T00:00:00Z",
		prs: [],
	} satisfies WorkspaceSession;
	const secondWorker = {
		...worker,
		id: "sess-2",
		title: "do the other thing",
		branch: "ao/sess-2",
	} satisfies WorkspaceSession;
	const orchestrator = {
		...worker,
		id: "sess-orch",
		kind: "orchestrator",
		title: "orchestrate",
	} satisfies WorkspaceSession;
	const crossProjectWorker = {
		...worker,
		id: "sess-cross-project",
		workspaceId: "proj-2",
		workspaceName: "other-app",
		title: "cross-project task",
		branch: "ao/cross-project",
	} satisfies WorkspaceSession;
	const workspaces: WorkspaceSummary[] = [
		{ id: "proj-1", name: "my-app", path: "/p", type: "main", sessions: [worker, secondWorker, orchestrator] },
		{ id: "proj-2", name: "other-app", path: "/q", type: "main", sessions: [crossProjectWorker] },
	];
	const workspaceQueryState: { data: WorkspaceSummary[] | undefined; isLoading: boolean } = {
		data: workspaces,
		isLoading: false,
	};
	const shellTerminalsState: {
		data: Array<{
			handleId: string;
			projectId?: string;
			sessionId?: string;
			title: string;
			workingDir: string;
			createdAt: string;
		}>;
	} = {
		data: [],
	};
	return { workspaces, workspaceQueryState, shellTerminalsState };
});

// The terminal and inspector body pull in xterm/SSE machinery irrelevant to
// the split under test. (ShellTopbar is shell-owned on Win/Linux; when the
// platform hides the shell topbar, SessionView mounts it in-panel.)
vi.mock("./ShellTopbar", () => ({
	ShellTopbar: ({
		sessionAction,
		compactActions,
	}: {
		sessionAction?: ReactNode;
		compactActions?: boolean;
	}) => (
		<div data-compact-actions={compactActions ? "true" : "false"} data-testid="mock-session-topbar">
			{sessionAction}
		</div>
	),
}));
vi.mock("./NotificationCenter", () => ({
	NotificationCenter: () => <button type="button">Notifications</button>,
}));
vi.mock("../hooks/useSessionHandoffMenu", () => ({
	useSessionHandoffMenu: () => ({
		agentSwitch: undefined,
		switchControlPresentation: undefined,
		switchError: null,
	}),
}));
vi.mock("./TerminalSwitchAgentButton", () => ({
	TerminalSwitchAgentButton: ({ variant }: { variant?: "icon" | "menu-item" }) =>
		variant === "menu-item" ? null : <button aria-label="Switch agent" type="button" />,
}));
vi.mock("./CenterPane", () => ({
	CenterPane: ({
		session,
		shellTerminals = [],
		onCloseShellTerminal,
		onSelectShellTerminal,
		onSelectSessionTerminal,
		onSelectReviewerTerminal,
		topbarActions,
		sessionTabAction,
		tabStripAction,
		workspaceTabs,
		workspaceTabActions,
		reviewerTerminal,
		terminalTarget,
		auxiliaryTabOrder,
		onAuxiliaryTabOrderChange,
	}: {
		session?: WorkspaceSession;
		shellTerminals?: Array<{ handleId: string; title: string }>;
		onCloseShellTerminal?: (handleId: string) => void;
		onSelectShellTerminal?: (handleId: string) => void;
		onSelectSessionTerminal?: () => void;
		onSelectReviewerTerminal?: (target: { handleId: string; harness: string }) => void;
		topbarActions?: ReactNode;
		sessionTabAction?: ReactNode;
		tabStripAction?: ReactNode;
		workspaceTabs?: Array<{ key: string; content: ReactNode; onSelect: () => void }>;
		workspaceTabActions?: ReactNode;
		reviewerTerminal?: { handleId: string; harness: string };
		terminalTarget?: { kind: string; handleId?: string };
		auxiliaryTabOrder?: string[];
		onAuxiliaryTabOrderChange?: (keys: string[]) => void;
	}) => (
		<div>
			terminal center
			<div data-testid={`auxiliary-tab-order-tui-${session?.id ?? "none"}`}>
				{auxiliaryTabOrder?.join("|") ?? ""}
			</div>
			<button
				type="button"
				onClick={() => onAuxiliaryTabOrderChange?.(["sh-a", "file:src/panel.tsx"])}
			>
				reorder auxiliary tabs
			</button>
			<button
				type="button"
				onClick={() =>
					onAuxiliaryTabOrderChange?.(["sh-a", "reviewer:review-sess-1", "file:src/panel.tsx"])
				}
			>
				reorder reviewer tab
			</button>
			<button
				type="button"
				onClick={() => onAuxiliaryTabOrderChange?.(["file:src/panel.tsx", "sh-a"])}
			>
				reorder visible tabs
			</button>
			{topbarActions}
			{sessionTabAction}
			<div role="tablist">
				{workspaceTabs?.map((tab) => <div key={tab.key}>{tab.content}</div>)}
				{workspaceTabActions}
				{tabStripAction}
			</div>
			<div data-testid="terminal-target">
				{terminalTarget?.kind === "shell" ? terminalTarget.handleId : (terminalTarget?.kind ?? "worker")}
			</div>
			<div data-testid="session-tab">{session?.title ?? ""}</div>
			<div data-testid="reviewer-harness">{reviewerTerminal?.harness ?? ""}</div>
			{reviewerTerminal ? (
				<button type="button" onClick={() => onSelectReviewerTerminal?.(reviewerTerminal)}>
					select reviewer tab
				</button>
			) : null}
			<div data-testid="shell-tabs">{shellTerminals.map((s) => s.title).join(",")}</div>
			{shellTerminals.map((s) => (
				<button key={s.handleId} type="button" onClick={() => onSelectShellTerminal?.(s.handleId)}>
					select {s.title}
				</button>
			))}
			{shellTerminals.map((s) => (
				<button key={`close-${s.handleId}`} type="button" onClick={() => onCloseShellTerminal?.(s.handleId)}>
					close {s.title}
				</button>
			))}
			<button type="button" onClick={() => onSelectSessionTerminal?.()}>
				select agent tab
			</button>
		</div>
	),
}));
vi.mock("./SessionFileExplorer", () => ({
	SessionFileExplorer: ({
		isMaximized,
		onOpenFile,
		onToggleMaximized,
		revealRequest,
	}: {
		isMaximized?: boolean;
		onOpenFile?: (path: string) => void;
		onToggleMaximized?: (next: boolean) => void;
		revealRequest?: { path: string; key: number } | null;
	}) => (
		<div>
			<button type="button" onClick={() => onToggleMaximized?.(!isMaximized)}>
				{isMaximized ? "files center" : "files rail"}
			</button>
			{!isMaximized && onOpenFile ? (
				<>
					<span>{revealRequest ? `rail preview ${revealRequest.path}` : "file tree"}</span>
					<button type="button">select src/App.tsx</button>
					<button type="button" onClick={() => onOpenFile("src/App.tsx")}>
						pop out src/App.tsx
					</button>
					{revealRequest ? (
						<button type="button" onClick={() => onOpenFile(revealRequest.path)}>
							pop out {revealRequest.path}
						</button>
					) : null}
				</>
			) : null}
		</div>
	),
}));
vi.mock("./SessionFileWorkspace", () => ({
	SessionFileWorkspace: ({ path }: { path: string }) => <div data-testid="session-file-workspace">{path}</div>,
}));
vi.mock("./SessionInspector", () => ({
	SessionInspector: ({
		filesView,
		isInspectorVisible = true,
		onOpenFiles,
		onOpenReviewFile,
		onViewChange,
		view,
	}: {
		filesView?: ReactNode;
		isInspectorVisible?: boolean;
		onOpenFiles?: () => void;
		onOpenReviewFile?: (target: { line?: number; path: string }) => void;
		onViewChange?: (view: InspectorView) => void;
		view?: string;
	}) => {
		inspectorVisibilityRenders.push(isInspectorVisible);
		return (
			<div>
				<button role="tab" type="button" onClick={() => onViewChange?.("summary")}>
					Summary
				</button>
				<button role="tab" type="button" onClick={() => onViewChange?.("reviews")}>
					Reviews
				</button>
				<button type="button" data-view={view} onClick={onOpenFiles}>
					open files
				</button>
				<button type="button" onClick={() => onOpenReviewFile?.({ path: "src/panel.tsx", line: 42 })}>
					view review file
				</button>
				<button type="button" onClick={() => onOpenReviewFile?.({ path: "notes.txt" })}>
					view review basename
				</button>
				{view === "files" ? filesView : null}
			</div>
		);
	},
}));
vi.mock("../lib/shell-context", () => ({
	useShell: () => ({ daemonStatus: { state: "ready" } }),
}));
vi.mock("../hooks/useWorkspaceQuery", () => ({
	useWorkspaceQuery: () => ({
		data: workspaceQueryState.data,
		isLoading: workspaceQueryState.isLoading,
	}),
	useWorkspaceSession: (sessionId: string) => ({
		data: workspaceQueryState.data
			?.flatMap((workspace) => workspace.sessions)
			.find((session) => session.id === sessionId),
		isLoading: workspaceQueryState.isLoading,
	}),
}));
// Standalone shell terminals are orthogonal to the split under test, and their
// real hooks would need a QueryClientProvider this suite deliberately omits.
vi.mock("../hooks/useShellTerminals", () => ({
	useShellTerminals: () => ({ data: shellTerminalsState.data, isLoading: false }),
	useOpenShellTerminal: () => ({ open: openShellTerminalMock, isPending: false }),
	useCloseShellTerminal: () => ({ mutate: closeShellTerminalMock }),
	useRenameShellTerminal: () => ({ mutate: vi.fn() }),
}));

function workerSession(sessionId: string): WorkspaceSession {
	const session = workspaces[0].sessions.find((item) => item.id === sessionId);
	if (!session) throw new Error(`missing test session ${sessionId}`);
	return session;
}

function inspectorOpen(sessionId: string): boolean {
	return useUiStore.getState().inspectorSessions[sessionId]?.isOpen ?? true;
}

function inspectorButton(): HTMLElement {
	const button = screen.getByText("open files").closest("button");
	if (!button) throw new Error("missing inspector button");
	return button;
}

function render(ui: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return {
		...rtlRender(ui, {
			wrapper: ({ children }) => (
				<QueryClientProvider client={client}>
					<TooltipProvider>
						<SessionTopbarProvider>{children}</SessionTopbarProvider>
					</TooltipProvider>
				</QueryClientProvider>
			),
		}),
		client,
	};
}

describe("SessionView", () => {
	beforeEach(() => {
		inspectorVisibilityRenders.length = 0;
		nativeFullScreenMock.mockReturnValue(false);
		window.localStorage.clear();
		for (const session of workspaces.flatMap((workspace) => workspace.sessions)) {
			delete session.isTerminated;
			session.status = "working";
			session.provider = "claude-code";
			delete session.mode;
			session.prs = [];
		}
		workspaceQueryState.data = workspaces;
		workspaceQueryState.isLoading = false;
		useUiStore.setState({
			activeShellTerminalHandleId: null,
			inspectorSessions: {},
			isSidebarOpen: true,
			orchestratorStartupErrors: {},
			visibleTerminalKindBySession: {},
		});
		shellTerminalsState.data = [];
		navigateMock.mockReset();
		openShellTerminalMock.mockReset();
		openShellTerminalMock.mockImplementation((input: { projectId?: string; sessionId?: string }) => ({
			handleId: "pending-shell:test",
			projectId: input.projectId,
			sessionId: input.sessionId,
			workingDir: "",
			title: "Terminal 1",
			createdAt: "2026-08-31T00:00:00Z",
			optimistic: true,
		}));
		closeShellTerminalMock.mockReset();
		codexAccountsQueryState.data = undefined;
		recoverCodexAccountSwitchMock.mockReset();
		reviewGetMock.mockReset();
		reviewGetMock.mockImplementation(async (path: string) => {
			if (path === "/api/v1/sessions/{sessionId}/workspace/files") {
				return {
					data: {
						sessionId: "sess-1",
						files: [],
						truncated: false,
						sections: { staged: [], unstaged: [], untracked: [], committed: [] },
						commits: [],
						summary: { files: 0, additions: 0, deletions: 0 },
					},
					error: undefined,
				};
			}
			return { data: { reviewerHandleId: "", reviews: [], runs: [] }, error: undefined };
		});
	});

	it("keeps the session route in a preparing state until the workspace query settles", () => {
		workspaceQueryState.data = [];
		workspaceQueryState.isLoading = true;
		render(<SessionView sessionId="sess-missing" />);
		expect(
			screen.getByText(
				"Preparing the orchestrator terminal. This can take a moment while AO creates the workspace and starts the agent.",
			),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Session not found. It may have been cleaned up — pick another from the sidebar."),
		).not.toBeInTheDocument();
		expect(screen.queryByText("No session selected. Pick a worker to attach its terminal.")).not.toBeInTheDocument();
	});

	it("shows session not found after the workspace query settles without the session", () => {
		workspaceQueryState.data = [];
		workspaceQueryState.isLoading = false;
		render(<SessionView sessionId="sess-missing" />);
		expect(
			screen.getByText("Session not found. It may have been cleaned up — pick another from the sidebar."),
		).toBeInTheDocument();
	});

	it("shows the spawn error when the routed session was rolled back", () => {
		workspaceQueryState.data = [];
		workspaceQueryState.isLoading = false;
		useUiStore.getState().setOrchestratorStartupError(
			"webreadr",
			"spawn webreadr-1: prepare: install hooks: pi.GetAgentHooks: probe pi --version: exit status 127",
		);
		render(<SessionView projectId="webreadr" sessionId="webreadr-1" />);
		expect(screen.getByText(/cannot run Pi/)).toBeInTheDocument();
		expect(
			screen.queryByText("Session not found. It may have been cleaned up — pick another from the sidebar."),
		).not.toBeInTheDocument();
	});

	it("offers recovery directly from a Codex session blocked by a failed account switch", async () => {
		const session = workerSession("sess-1");
		session.provider = "codex";
		codexAccountsQueryState.data = {
			currentSwitch: {
				id: "switch-1",
				sourceAccountId: "account-a",
				targetAccountId: "account-b",
				phase: "recovery_required",
				canRecover: true,
				sessions: [{
					sessionId: "sess-1",
					interfaceMode: "tui",
					wasRunning: true,
					stopState: "stopped",
					restartState: "failed",
				}],
				createdAt: "2026-09-02T00:00:00Z",
				updatedAt: "2026-09-02T00:01:00Z",
			},
		};
		recoverCodexAccountSwitchMock.mockResolvedValue(undefined);

		render(<SessionView sessionId="sess-1" />);

		const retry = screen.getByRole("button", { name: "Retry recovery" });
		expect(retry).toBeEnabled();
		await userEvent.click(retry);
		expect(recoverCodexAccountSwitchMock).toHaveBeenCalledWith("switch-1");
	});

	// Regression: shell terminals are an app-wide list, so without a per-session
	// filter a shell opened in another session would show up as a tab in this
	// session's strip. Only this session's shells (not another session's, and no
	// session-less ones) should reach the terminal pane.
	it("shows only the current session's shell terminals as tabs", () => {
		shellTerminalsState.data = [
			{
				handleId: "sh-a",
				sessionId: "sess-1",
				title: "sess-1-shell",
				workingDir: "/p",
				createdAt: "2026-07-24T00:00:00Z",
			},
			{
				handleId: "sh-b",
				sessionId: "sess-2",
				title: "sess-2-shell",
				workingDir: "/q",
				createdAt: "2026-07-24T00:00:00Z",
			},
			{ handleId: "sh-c", title: "loose-shell", workingDir: "/r", createdAt: "2026-07-24T00:00:00Z" },
		];
		render(<SessionView sessionId="sess-1" />);
		const tabs = screen.getByTestId("shell-tabs");
		expect(tabs).toHaveTextContent("sess-1-shell");
		expect(tabs).not.toHaveTextContent("sess-2-shell");
		expect(tabs).not.toHaveTextContent("loose-shell");
	});

	// The pane shows one terminal at a time, so selecting a shell takes the
	// agent's terminal off screen while the route still points at this session.
	// The notification runtime lives outside this subtree and reads the published
	// kind to decide whether the user can actually see a needs_input prompt.
	it("publishes which terminal the session pane is showing", () => {
		shellTerminalsState.data = [
			{
				handleId: "sh-a",
				sessionId: "sess-1",
				title: "sess-1-shell",
				workingDir: "/p",
				createdAt: "2026-07-24T00:00:00Z",
			},
		];
		const view = render(<SessionView sessionId="sess-1" />);
		expect(useUiStore.getState().visibleTerminalKindBySession["sess-1"]).toBe("worker");

		fireEvent.click(screen.getByRole("button", { name: "select sess-1-shell" }));
		expect(useUiStore.getState().visibleTerminalKindBySession["sess-1"]).toBe("shell");

		fireEvent.click(screen.getByRole("button", { name: "select agent tab" }));
		expect(useUiStore.getState().visibleTerminalKindBySession["sess-1"]).toBe("worker");

		// Leaving the session drops the entry rather than leaving a stale "worker"
		// behind for a pane that is no longer mounted.
		view.unmount();
		expect(useUiStore.getState().visibleTerminalKindBySession["sess-1"]).toBeUndefined();
	});

	it("keeps a session-scoped shell reachable from the session pane", () => {
		shellTerminalsState.data = [
			{
				handleId: "session-shell",
				sessionId: "sess-1",
				title: "session worktree shell",
				workingDir: "/p",
				createdAt: "2026-08-04T00:00:00Z",
			},
		];

		render(<SessionView sessionId="sess-1" />);
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("worker");

		// Selecting the shell swaps the active pane while the route stays here.
		act(() => useUiStore.getState().setActiveShellTerminal("session-shell"));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("shell");

		fireEvent.click(screen.getByRole("button", { name: "select agent tab" }));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("worker");
	});

	// The strip only ever shows the session on screen — pinning another session's
	// terminal as a tab (and the cross-project picker that did it) is gone (#3208).
	it("shows only the session on screen in the tab strip", () => {
		render(<SessionView sessionId="sess-1" />);

		expect(screen.getByTestId("session-tab")).toHaveTextContent("do the thing");
		expect(screen.getByTestId("session-tab")).not.toHaveTextContent("do the other thing");
		expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
	});

	// The daemon roots a shell in the session's worktree when it is given that
	// session's id, so a new terminal must name the session actually on screen.
	it("opens new terminals in the on-screen session's worktree", () => {
		render(<SessionView sessionId="sess-2" />);

		const newTerminalButton = screen.getByRole("button", { name: "New terminal" });
		fireEvent.click(newTerminalButton);
		expect(openShellTerminalMock).toHaveBeenCalledWith({ projectId: "proj-1", sessionId: "sess-2" }, expect.anything());
		expect(useUiStore.getState().activeShellTerminalHandleId).toBe("pending-shell:test");
	});

	it("activates a new terminal opened while a file tab is selected", async () => {
		const shell = {
			handleId: "sh-after-file",
			projectId: "proj-1",
			sessionId: "sess-1",
			title: "Terminal 1",
			workingDir: "/p",
			createdAt: "2026-08-31T00:00:00Z",
		};
		openShellTerminalMock.mockImplementation((_input, options) => {
			shellTerminalsState.data = [shell];
			options.onSuccess(shell);
		});
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "view review file" }));
		await screen.findByText("rail preview src/panel.tsx");
		fireEvent.click(screen.getByRole("button", { name: "pop out src/panel.tsx" }));
		expect(await screen.findByTestId("session-file-workspace")).toHaveTextContent("src/panel.tsx");

		fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
		expect(screen.queryByTestId("session-file-workspace")).not.toBeInTheDocument();
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("sh-after-file");
	});

	it("does not offer a new terminal for orchestrator sessions", () => {
		render(<SessionView sessionId="sess-orch" />);

		expect(screen.queryByRole("button", { name: "New terminal" })).not.toBeInTheDocument();
	});

	// Regression (#3874 then re-added by #4252): the prime top bar carries session
	// identity, status, and controls — never the worktree branch. A branch badge
	// beside the actions duplicates a fact the inspector, board card, and command
	// palette already own, and its long name crowds the controls it sits next to.
	it.each([
		["a terminal worker", "sess-1", "tui", true],
		["an orchestrator", "sess-orch", "tui", false],
	] as const)("keeps the git branch out of %s session's top bar", (_label, sessionId, mode, offersNewTerminal) => {
		workerSession(sessionId).mode = mode;

		render(<SessionView sessionId={sessionId} />);

		expect(screen.queryByText("ao/sess-1")).not.toBeInTheDocument();
		expect(screen.queryByTitle("ao/sess-1")).not.toBeInTheDocument();
		expect(document.querySelector(".lucide-git-branch")).toBeNull();
		// The session's own actions still ride in the same top-bar slot.
		expect(screen.getByTestId("mock-session-topbar")).toBeInTheDocument();
		expect(Boolean(screen.queryByRole("button", { name: "New terminal" }))).toBe(offersNewTerminal);
	});

	it("shows a shell opened from the session and returns to the agent tab", () => {
		const shell = {
			handleId: "sh-session",
			projectId: "proj-1",
			sessionId: "sess-1",
			title: "session shell",
			workingDir: "/p",
			createdAt: "2026-08-04T00:00:00Z",
		};
		openShellTerminalMock.mockImplementation((_input, options) => {
			shellTerminalsState.data = [shell];
			options.onSuccess(shell);
			return shell;
		});

		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
		expect(screen.getByTestId("shell-tabs")).toHaveTextContent("session shell");
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("sh-session");

		fireEvent.click(screen.getByRole("button", { name: "select agent tab" }));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("worker");
	});

	it("preserves mixed tab order across session navigation", async () => {
		shellTerminalsState.data = [
			{
				handleId: "sh-a",
				projectId: "proj-1",
				sessionId: "sess-1",
				title: "session one shell",
				workingDir: "/p",
				createdAt: "2026-08-31T00:00:00Z",
			},
		];
		const view = render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "view review file" }));
		await screen.findByText("rail preview src/panel.tsx");
		fireEvent.click(screen.getByRole("button", { name: "pop out src/panel.tsx" }));
		await screen.findByTestId("session-file-workspace");
		fireEvent.click(screen.getByRole("button", { name: "reorder auxiliary tabs" }));
		expect(screen.getByTestId("auxiliary-tab-order-tui-sess-1")).toHaveTextContent(
			"sh-a|file:src/panel.tsx",
		);

		view.rerender(<SessionView sessionId="sess-2" />);
		view.rerender(<SessionView sessionId="sess-1" />);

		expect(screen.getByTestId("auxiliary-tab-order-tui-sess-1")).toHaveTextContent(
			"sh-a|file:src/panel.tsx",
		);
	});

	it("selects the adjacent shell when closing a reordered file tab", async () => {
		shellTerminalsState.data = [
			{
				handleId: "sh-a",
				projectId: "proj-1",
				sessionId: "sess-1",
				title: "session one shell",
				workingDir: "/p",
				createdAt: "2026-08-31T00:00:00Z",
			},
		];
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "view review file" }));
		await screen.findByText("rail preview src/panel.tsx");
		fireEvent.click(screen.getByRole("button", { name: "pop out src/panel.tsx" }));
		await screen.findByTestId("session-file-workspace");
		fireEvent.click(screen.getByRole("button", { name: "reorder auxiliary tabs" }));
		fireEvent.click(screen.getByRole("button", { name: "Close panel.tsx" }));

		expect(screen.queryByTestId("session-file-workspace")).not.toBeInTheDocument();
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("sh-a");
	});

	it("preserves a reordered reviewer position while the session is inactive", async () => {
		const worker = workerSession("sess-1");
		worker.prs = [
			{
				url: "https://github.com/acme/repo/pull/7",
				number: 7,
				state: "open",
				ci: "passing",
				review: "none",
				mergeability: "mergeable",
				reviewComments: false,
				updatedAt: "2026-06-15T00:00:00Z",
			},
		];
		shellTerminalsState.data = [
			{
				handleId: "sh-a",
				projectId: "proj-1",
				sessionId: "sess-1",
				title: "session one shell",
				workingDir: "/p",
				createdAt: "2026-08-31T00:00:00Z",
			},
		];
		reviewGetMock.mockResolvedValueOnce({
			data: { reviewerHandleId: "review-sess-1", reviewerHarness: "codex", reviews: [] },
			error: undefined,
		});
		const view = render(<SessionView sessionId="sess-1" />);

		await screen.findByRole("button", { name: "select reviewer tab" });
		fireEvent.click(screen.getByRole("button", { name: "view review file" }));
		await screen.findByText("rail preview src/panel.tsx");
		fireEvent.click(screen.getByRole("button", { name: "pop out src/panel.tsx" }));
		await screen.findByTestId("session-file-workspace");
		fireEvent.click(screen.getByRole("button", { name: "reorder reviewer tab" }));
		expect(screen.getByTestId("auxiliary-tab-order-tui-sess-1")).toHaveTextContent(
			"sh-a|reviewer:review-sess-1|file:src/panel.tsx",
		);

		worker.status = "terminated";
		worker.isTerminated = true;
		view.rerender(<SessionView sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "reorder visible tabs" }));
		worker.status = "working";
		worker.isTerminated = false;
		view.rerender(<SessionView sessionId="sess-1" />);

		await screen.findByRole("button", { name: "select reviewer tab" });
		expect(screen.getByTestId("auxiliary-tab-order-tui-sess-1")).toHaveTextContent(
			"file:src/panel.tsx|reviewer:review-sess-1|sh-a",
		);
	});

	it("keeps a shell's reordered position when closing it fails", async () => {
		shellTerminalsState.data = [
			{
				handleId: "sh-a",
				projectId: "proj-1",
				sessionId: "sess-1",
				title: "session one shell",
				workingDir: "/p",
				createdAt: "2026-08-31T00:00:00Z",
			},
		];
		closeShellTerminalMock.mockImplementation((_handleId, options) => {
			options?.onError?.({ code: "SHELL_TERMINAL_CLOSE_FAILED" });
		});
		const view = render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "view review file" }));
		await screen.findByText("rail preview src/panel.tsx");
		fireEvent.click(screen.getByRole("button", { name: "pop out src/panel.tsx" }));
		await screen.findByTestId("session-file-workspace");
		fireEvent.click(screen.getByRole("button", { name: "reorder auxiliary tabs" }));
		fireEvent.click(screen.getByRole("button", { name: "select session one shell" }));
		fireEvent.click(screen.getByRole("button", { name: "close session one shell" }));
		view.rerender(<SessionView sessionId="sess-1" />);

		expect(screen.getByTestId("auxiliary-tab-order-tui-sess-1")).toHaveTextContent(
			"sh-a|file:src/panel.tsx",
		);
	});

	it("walks backward through auxiliary terminals before returning to the permanent terminal", () => {
		shellTerminalsState.data = [
			{
				handleId: "sh-a",
				sessionId: "sess-1",
				title: "first shell",
				workingDir: "/p",
				createdAt: "2026-07-24T00:00:00Z",
			},
			{
				handleId: "sh-b",
				sessionId: "sess-1",
				title: "second shell",
				workingDir: "/p",
				createdAt: "2026-07-24T00:01:00Z",
			},
		];
		const view = render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "select second shell" }));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("sh-b");

		fireEvent.click(screen.getByRole("button", { name: "close second shell" }));
		expect(closeShellTerminalMock).toHaveBeenCalledWith("sh-b", expect.any(Object));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("sh-a");
		expect(useUiStore.getState().activeShellTerminalHandleId).toBe("sh-a");

		shellTerminalsState.data = shellTerminalsState.data.filter((shell) => shell.handleId !== "sh-b");
		view.rerender(<SessionView sessionId="sess-1" />);
		fireEvent.click(screen.getByRole("button", { name: "close first shell" }));
		expect(closeShellTerminalMock).toHaveBeenCalledWith("sh-a", expect.any(Object));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("worker");
		expect(useUiStore.getState().activeShellTerminalHandleId).toBeNull();
	});

	it("uses the stored reviewer harness for the reviewer tab icon when no latest run is current", async () => {
		const worker = workerSession("sess-1");
		worker.prs = [
			{
				url: "https://github.com/acme/repo/pull/7",
				number: 7,
				state: "open",
				ci: "passing",
				review: "none",
				mergeability: "mergeable",
				reviewComments: false,
				updatedAt: "2026-06-15T00:00:00Z",
			},
		];
		reviewGetMock.mockResolvedValueOnce({
			data: { reviewerHandleId: "review-sess-1", reviewerHarness: "codex", reviews: [], runs: [] },
			error: undefined,
		});

		render(<SessionView sessionId="sess-1" />);

		await waitFor(() => expect(screen.getByTestId("reviewer-harness")).toHaveTextContent("codex"));
	});

	it("keeps the reviewer terminal reachable from the session pane", async () => {
		const worker = workerSession("sess-1");
		worker.prs = [{
			url: "https://github.com/acme/repo/pull/7",
			number: 7,
			state: "open",
			ci: "passing",
			review: "none",
			mergeability: "mergeable",
			reviewComments: false,
			updatedAt: "2026-06-15T00:00:00Z",
		}];
		reviewGetMock.mockResolvedValueOnce({
			data: { reviewerHandleId: "review-sess-1", reviewerHarness: "codex", reviews: [], runs: [] },
			error: undefined,
		});

		render(<SessionView sessionId="sess-1" />);
		await screen.findByRole("button", { name: "select reviewer tab" });
		fireEvent.click(screen.getByRole("button", { name: "select reviewer tab" }));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("reviewer");
		// Selecting the agent tab returns to the session terminal.
		fireEvent.click(screen.getByRole("button", { name: "select agent tab" }));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("worker");
	});

	it("returns to the session terminal when the reviewer handle is cleared", async () => {
		const worker = workerSession("sess-1");
		worker.prs = [
			{
				url: "https://github.com/acme/repo/pull/7",
				number: 7,
				state: "open",
				ci: "passing",
				review: "none",
				mergeability: "mergeable",
				reviewComments: false,
				updatedAt: "2026-06-15T00:00:00Z",
			},
		];
		reviewGetMock.mockResolvedValueOnce({
			data: { reviewerHandleId: "review-sess-1", reviewerHarness: "codex", reviews: [] },
			error: undefined,
		});

		const view = render(<SessionView sessionId="sess-1" />);
		await screen.findByRole("button", { name: "select reviewer tab" });
		fireEvent.click(screen.getByRole("button", { name: "select reviewer tab" }));
		expect(screen.getByTestId("terminal-target")).toHaveTextContent("reviewer");

		act(() => {
			view.client.setQueryData(["session-reviews", "sess-1"], { reviewerHandleId: "", reviews: [] });
		});

		await waitFor(() => expect(screen.getByTestId("terminal-target")).toHaveTextContent("worker"));
		expect(screen.queryByRole("button", { name: "select reviewer tab" })).not.toBeInTheDocument();
	});

	it("restores the selected reviewer terminal when the session becomes active again", async () => {
			const worker = workerSession("sess-1");
			worker.prs = [
				{
					url: "https://github.com/acme/repo/pull/7",
					number: 7,
					state: "open",
					ci: "passing",
					review: "none",
					mergeability: "mergeable",
					reviewComments: false,
					updatedAt: "2026-06-15T00:00:00Z",
				},
			];
			reviewGetMock.mockResolvedValueOnce({
				data: { reviewerHandleId: "review-sess-1", reviewerHarness: "codex", reviews: [] },
				error: undefined,
			});

			const view = render(<SessionView sessionId="sess-1" />);
			const reviewerButtonName = "select reviewer tab";
			await screen.findByRole("button", { name: reviewerButtonName });
			fireEvent.click(screen.getByRole("button", { name: reviewerButtonName }));
			expect(screen.getByTestId("terminal-target")).toHaveTextContent("reviewer");

			worker.status = "terminated";
			worker.isTerminated = true;
			view.rerender(<SessionView sessionId="sess-1" />);
			expect(screen.getByTestId("terminal-target")).toHaveTextContent("reviewer");
			expect(screen.queryByRole("button", { name: reviewerButtonName })).not.toBeInTheDocument();

			worker.status = "working";
			worker.isTerminated = false;
			view.rerender(<SessionView sessionId="sess-1" />);

			await screen.findByRole("button", { name: reviewerButtonName });
			expect(screen.getByTestId("terminal-target")).toHaveTextContent("reviewer");
		},
	);

	it("opens the inspector with the shared sidebar spring tokens", () => {
		render(<SessionView sessionId="sess-1" />);

		expect(screen.getByTestId("panel-group")).toHaveStyle({
			"--session-inspector-motion-duration": "300ms",
			"--session-inspector-motion-easing":
				"linear(0, 0.333 12.5%, 0.642 25%, 0.813 37.5%, 0.902 50%, 0.949 62.5%, 0.974 75%, 0.986 87.5%, 1)",
		});
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "expanded");
		expect(screen.getByTestId("inspector-resize-handle")).toBeInTheDocument();
	});

	it("opens the Summary inspector alongside the terminal by default", () => {
		render(<SessionView sessionId="sess-1" />);

		expect(screen.getByText("terminal center")).toBeInTheDocument();
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "expanded");
		expect(screen.getByTestId("inspector-resize-handle")).not.toHaveClass("hidden");
		expect(screen.getByTestId("panel-inspector")).not.toHaveAttribute("inert");
		expect(inspectorButton()).toHaveAttribute("data-view", "summary");
	});


	it("mounts the inspector open by default", () => {
		render(<SessionView sessionId="sess-1" />);

		const pane = screen.getByTestId("panel-inspector");
		expect(pane).not.toHaveAttribute("inert");
		expect(pane).toHaveAttribute("aria-hidden", "false");
		expect(pane).toHaveAttribute("data-state", "expanded");
	});

	it("mounts collapsed and inert when the store says closed", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", false));
		render(<SessionView sessionId="sess-1" />);

		const pane = screen.getByTestId("panel-inspector");
		expect(pane).toHaveAttribute("inert");
		expect(pane).toHaveAttribute("aria-hidden", "true");
		expect(pane).toHaveAttribute("data-state", "collapsed");
		expect(pane).toHaveAttribute("hidden");
		expect(screen.getByTestId("inspector-resize-handle")).toHaveClass("hidden");
		expect(screen.getByTestId("inspector-collapsed-rail")).toBeInTheDocument();
	});

	it("keeps inspector chrome visible from the first render of the opening transition", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", false));
		render(<SessionView sessionId="sess-1" />);
		const renderCountBeforeOpening = inspectorVisibilityRenders.length;

		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));

		const openingRenders = inspectorVisibilityRenders.slice(renderCountBeforeOpening);
		expect(openingRenders.length).toBeGreaterThan(0);
		expect(openingRenders).not.toContain(false);
	});

	it("starts collapsing the resize handle with the inspector panel", () => {
		render(<SessionView sessionId="sess-1" />);

		fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });

		expect(screen.getByTestId("inspector-resize-handle")).toHaveClass("hidden");
		expect(screen.getByTestId("inspector-collapsed-rail")).toBeInTheDocument();
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("aria-hidden", "false");
	});

	it("keeps StrictMode mount from collapsing, then collapses on the first user toggle", () => {
		render(
			<StrictMode>
				<SessionView sessionId="sess-1" />
			</StrictMode>,
		);

		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "expanded");

		fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });

		expect(inspectorOpen("sess-1")).toBe(false);
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "collapsed");
	});

	it("marks the split for live terminal fitting throughout the inspector transition", () => {
		vi.useFakeTimers();
		try {
			render(<SessionView sessionId="sess-1" />);

			fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });
			const split = screen.getByTestId("panel-group");
			expect(split).toHaveAttribute("data-terminal-live-resize", "true");
			expect(split).toHaveAttribute("data-topbar-secondary-label-mode", "expanded");

			act(() => vi.advanceTimersByTime(299));
			expect(split).toHaveAttribute("data-terminal-live-resize", "true");
			expect(split).toHaveAttribute("data-topbar-secondary-label-mode", "expanded");

			act(() => vi.advanceTimersByTime(1));
			expect(split).not.toHaveAttribute("data-terminal-live-resize");
			expect(split).not.toHaveAttribute("data-topbar-secondary-label-mode");
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps inspector labels expanded at the default width throughout the opening transition", () => {
		vi.useFakeTimers();
		try {
			act(() => useUiStore.getState().setInspectorOpen("sess-1", false));
			render(<SessionView sessionId="sess-1" />);

			act(() => useUiStore.getState().setInspectorOpen("sess-1", true));

			const split = screen.getByTestId("panel-group");
			expect(split).toHaveAttribute("data-terminal-live-resize", "true");
			expect(split).toHaveAttribute("data-inspector-label-mode", "expanded");
			expect(split).toHaveAttribute("data-topbar-secondary-label-mode", "compact");

			act(() => vi.advanceTimersByTime(299));
			expect(split).toHaveAttribute("data-inspector-label-mode", "expanded");
			expect(split).toHaveAttribute("data-topbar-secondary-label-mode", "compact");

			act(() => vi.advanceTimersByTime(1));
			expect(split).not.toHaveAttribute("data-inspector-label-mode");
			expect(split).not.toHaveAttribute("data-topbar-secondary-label-mode");
		} finally {
			vi.useRealTimers();
		}
	});

	it("locks responsive inspector labels compact when the opening target is narrow", () => {
		vi.useFakeTimers();
		const clientWidth = vi
			.spyOn(HTMLElement.prototype, "clientWidth", "get")
			.mockImplementation(function (this: HTMLElement) {
				return this.dataset.testid === "panel-group" ? 640 : 640;
			});
		try {
			act(() => useUiStore.getState().setInspectorOpen("sess-1", false));
			render(<SessionView sessionId="sess-1" />);

			act(() => useUiStore.getState().setInspectorOpen("sess-1", true));

			const split = screen.getByTestId("panel-group");
			expect(split).toHaveAttribute("data-inspector-label-mode", "compact");
			expect(split).toHaveAttribute("data-topbar-secondary-label-mode", "compact");
		} finally {
			clientWidth.mockRestore();
			vi.useRealTimers();
		}
	});

	it("keeps StrictMode mount from expanding, then expands on the first user toggle", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", false));
		render(
			<StrictMode>
				<SessionView sessionId="sess-1" />
			</StrictMode>,
		);

		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "collapsed");

		fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });

		expect(inspectorOpen("sess-1")).toBe(true);
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "expanded");
	});

	it("toggles the inspector with mod+shift+B", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);

		fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });
		expect(inspectorOpen("sess-1")).toBe(false);
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "collapsed");

		fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });
		expect(inspectorOpen("sess-1")).toBe(true);
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "expanded");

		// Plain ⌘B belongs to the sidebar — the inspector must not react.
		fireEvent.keyDown(window, { key: "b", metaKey: true });
		expect(inspectorOpen("sess-1")).toBe(true);
	});

	it("keeps the inspector toggle and trailing notification pinned while the panel changes state", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);
		const actions = screen.getByTestId("session-pinned-actions");
		const toggle = within(actions).getByRole("button", { name: "Close inspector panel" });
		const notification = within(actions).getByRole("button", { name: "Notifications" });
		const buttons = within(actions).getAllByRole("button");
		expect(buttons.indexOf(notification)).toBeGreaterThan(buttons.indexOf(toggle));
		expect(toggle).toHaveAttribute("aria-pressed", "true");

		fireEvent.click(toggle);

		expect(inspectorOpen("sess-1")).toBe(false);
		expect(screen.getByTestId("session-pinned-actions")).toBe(actions);
		expect(screen.getByRole("button", { name: "Notifications" })).toBe(notification);
		expect(screen.getByRole("button", { name: "Open inspector panel" })).toBe(toggle);
		expect(toggle).toHaveAttribute("aria-pressed", "false");
	});



	it("restores and clamps the persisted inspector width in pixels", () => {
		window.localStorage.setItem("ao.inspector.widthPx", "240");
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);
		expect(document.documentElement.style.getPropertyValue("--ao-inspector-w")).toBe("340px");
	});





	it("mounts the inspector in sync when navigating from an orchestrator session", () => {
		const { rerender } = render(<SessionView sessionId="sess-orch" />);
		expect(screen.queryByTestId("panel-inspector")).not.toBeInTheDocument();

		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		rerender(<SessionView sessionId="sess-1" />);

		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "expanded");
		expect(screen.getByTestId("panel-inspector")).not.toHaveAttribute("inert");
	});

	it("expands on the first toggle after a closed worker inspector remounts", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", false));
		const { rerender } = render(<SessionView sessionId="sess-1" />);

		act(() => useUiStore.getState().setInspectorOpen("sess-2", false));
		rerender(<SessionView sessionId="sess-orch" />);
		expect(screen.queryByTestId("panel-inspector")).not.toBeInTheDocument();

		act(() => useUiStore.getState().setInspectorOpen("sess-2", false));
		rerender(<SessionView sessionId="sess-2" />);
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "collapsed");

		fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });

		expect(inspectorOpen("sess-2")).toBe(true);
		expect(screen.getByTestId("panel-inspector")).toHaveAttribute("data-state", "expanded");
	});

	it("renders no inspector panel or handle for orchestrator sessions", () => {
		render(<SessionView sessionId="sess-orch" />);

		expect(screen.queryByTestId("panel-inspector")).not.toBeInTheDocument();
		expect(screen.queryByTestId("inspector-resize-handle")).not.toBeInTheDocument();
		expect(screen.queryByTestId("inspector-collapsed-rail")).not.toBeInTheDocument();

		// The shortcut is inactive without an inspector.
		fireEvent.keyDown(window, { key: "B", metaKey: true, shiftKey: true });
		expect(useUiStore.getState().inspectorSessions["sess-orch"]).toBeUndefined();
	});




	it("opens the files view in the inspector rail first", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "open files" }));

		expect(
			within(screen.getByTestId("panel-inspector")).getByRole("button", { name: "files rail" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "files center" })).not.toBeInTheDocument();
		expect(screen.getByText("terminal center")).toBeInTheDocument();
	});

	it("previews docked files and only opens a center tab on explicit pop-out", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "open files" }));
		fireEvent.click(screen.getByRole("button", { name: "select src/App.tsx" }));

		expect(screen.queryByRole("tab", { name: "App.tsx" })).not.toBeInTheDocument();
		expect(screen.queryByTestId("session-file-workspace")).not.toBeInTheDocument();
		expect(screen.getByText("terminal center")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "pop out src/App.tsx" }));

		expect(screen.getByRole("tab", { name: "App.tsx" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByTestId("session-file-workspace")).toHaveTextContent("src/App.tsx");
		expect(screen.getByText("terminal center")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "select agent tab" }));
		expect(screen.queryByTestId("session-file-workspace")).not.toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "App.tsx" })).toHaveAttribute("aria-selected", "false");
	});

	it("previews a review file target in the Files inspector without replacing the center", async () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "view review file" }));

		await waitFor(() => {
			expect(screen.getByText("rail preview src/panel.tsx")).toBeInTheDocument();
		});
		expect(screen.queryByRole("tab", { name: "panel.tsx" })).not.toBeInTheDocument();
		expect(screen.queryByTestId("session-file-workspace")).not.toBeInTheDocument();
		expect(screen.getByText("terminal center")).toBeInTheDocument();
		expect(useUiStore.getState().inspectorSessions["sess-1"]?.view).toBe("files");
		expect(screen.queryByRole("button", { name: "files center" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "pop out src/panel.tsx" }));
		expect(screen.getByRole("tab", { name: "panel.tsx" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByTestId("session-file-workspace")).toHaveTextContent("src/panel.tsx");
	});

	it("resolves a basename against workspace files before opening on a cold cache", async () => {
		reviewGetMock.mockImplementation(async (path: string) => {
			if (path === "/api/v1/sessions/{sessionId}/workspace/files") {
				return {
					data: {
						sessionId: "sess-1",
						files: [
							{
								path: "docs/notes.txt",
								status: "added",
								additions: 1,
								deletions: 0,
								binary: false,
								size: 10,
							},
						],
						truncated: false,
						sections: { staged: [], unstaged: [], untracked: [], committed: [] },
						commits: [],
						summary: { files: 1, additions: 1, deletions: 0 },
					},
					error: undefined,
				};
			}
			return { data: { reviewerHandleId: "", reviews: [], runs: [] }, error: undefined };
		});

		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "view review basename" }));

		await waitFor(() => {
			expect(screen.getByText("rail preview docs/notes.txt")).toBeInTheDocument();
		});
		expect(screen.queryByTestId("session-file-workspace")).not.toBeInTheDocument();
	});

	it("maximizes files over the whole app window and returns to the rail", () => {
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "open files" }));
		fireEvent.click(within(screen.getByTestId("panel-inspector")).getByRole("button", { name: "files rail" }));

		expect(screen.getByRole("button", { name: "files center" })).toBeInTheDocument();
		const overlay = document.querySelector(".files-popout-overlay");
		expect(overlay).toHaveClass("files-popout-overlay--mac-windowed");
		expect(overlay?.parentElement).toBe(document.body);
		expect(screen.getByText("terminal center")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "files center" }));
		expect(screen.queryByRole("button", { name: "files center" })).not.toBeInTheDocument();
		expect(
			within(screen.getByTestId("panel-inspector")).getByRole("button", { name: "files rail" }),
		).toBeInTheDocument();
		expect(screen.getByText("terminal center")).toBeInTheDocument();
	});

	it("does not reserve the traffic-light band for maximized files during native macOS fullscreen", () => {
		nativeFullScreenMock.mockReturnValue(true);
		act(() => useUiStore.getState().setInspectorOpen("sess-1", true));
		render(<SessionView sessionId="sess-1" />);

		fireEvent.click(screen.getByRole("button", { name: "open files" }));
		fireEvent.click(within(screen.getByTestId("panel-inspector")).getByRole("button", { name: "files rail" }));

		expect(document.querySelector(".files-popout-overlay")).not.toHaveClass("files-popout-overlay--mac-windowed");
	});




	// Regression: the session-entry effect that defaults a brand-new session to
	// Summary tracked only the single most-recently-initialized session ID, so
	// re-entering ANY session that was not the immediately preceding one looked
	// identical to a first-ever visit and forced it back to Summary — silently
	it("remembers the tab a session was left on when returning to it after visiting another session", () => {
		const { rerender } = render(<SessionView sessionId="sess-1" />);
		expect(inspectorButton()).toHaveAttribute("data-view", "summary");

		fireEvent.click(screen.getByRole("button", { name: "open files" }));
		expect(inspectorButton()).toHaveAttribute("data-view", "files");

		rerender(<SessionView sessionId="sess-2" />);
		expect(inspectorButton()).toHaveAttribute("data-view", "summary");

		rerender(<SessionView sessionId="sess-1" />);
		expect(inspectorButton()).toHaveAttribute("data-view", "files");
	});

	// Regression: the "initialized" marker used to live in a component-local
	// ref, which is recreated whenever SessionView unmounts. Remounting an
	// already-visited session (e.g. across a route transition) then looked
	// identical to a first-ever visit and forced the tab back to Summary. The
	// marker now lives in the ui-store's persisted inspectorSessions state, so
	// it survives unmount/remount, not just re-renders of one mounted instance.
	it("remembers the tab a session was left on after unmounting and remounting the view", () => {
		const view = render(<SessionView sessionId="sess-1" />);
		expect(inspectorButton()).toHaveAttribute("data-view", "summary");

		fireEvent.click(screen.getByRole("button", { name: "open files" }));
		expect(inspectorButton()).toHaveAttribute("data-view", "files");

		view.unmount();

		render(<SessionView sessionId="sess-1" />);
		expect(inspectorButton()).toHaveAttribute("data-view", "files");
	});







	// activity even on an empty target that has not navigated anywhere yet.
	// command run before any page loaded never surfaced as unseen.
});
