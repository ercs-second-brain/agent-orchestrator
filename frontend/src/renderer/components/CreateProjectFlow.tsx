import * as Dialog from "@radix-ui/react-dialog";
import {
	CheckCircle2,
	CircleDashed,
	ChevronRight,
	Folder,
	FolderClosed,
	FolderPlus,
	Folders,
	GitFork,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { components } from "../../api/schema";
import type { ImportFolderScan } from "../../preload";
import { apiClient, apiErrorMessage } from "../lib/api-client";
import { aoBridge } from "../lib/bridge";
import { useShellMaybe } from "../lib/shell-context";
import { cn } from "../lib/utils";
import type { ProjectKind } from "../types/workspace";
// ADR 0005: pi is the only agent, so the former agent-pick sheet is gone. The
// selection collapses to fixed pi values and the flow submits directly.
export type CreateProjectAgentSelection = { workerAgent: string; orchestratorAgent: string };
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import CloneRepositoryDialog, { type CloneRepositoryDetails, type CloneRepositorySelection } from "./CloneRepositoryDialog";
import CreateRepositoryDialog, { type CreateRepositoryDetails } from "./CreateRepositoryDialog";

export type CreateProjectInput = { path: string; asWorkspace?: boolean; defaultBranch?: string } & CreateProjectAgentSelection;
export type CloneProjectInput = Pick<CloneRepositorySelection, "remoteUrl" | "destinationParent"> &
	CreateProjectAgentSelection;
export type CreateRepositoryInput = CreateRepositoryDetails & CreateProjectAgentSelection;

const LAST_CLONE_DESTINATION_KEY = "ao.clone.lastDestinationParent";
// Remote daemons cannot see the client filesystem, so clones are locked to this
// daemon-host folder instead of offering the local folder picker.
const REMOTE_CLONE_DESTINATION_PARENT = "~/projects";
const LAST_IMPORT_REMOTE_URL_KEY = "ao.import.lastRemoteUrl";
type ImportValidationResult = components["schemas"]["ImportValidationResult"];
type GitPreparationEvent = components["schemas"]["GitPreparationEvent"];
type ProjectImportStep = "blocked" | "prepare_git";

type CreateProjectFlowMode = ProjectKind | "choose";
export type ProjectSource = "clone" | "create" | "local" | "workspace";

// Shared create-project flow. Local projects/workspaces use the native folder
// picker; remote projects progressively reveal a lazily loaded clone form.
// Every source converges on the same agent sheet and project-start behavior.
export function CreateProjectFlow({
	children,
	droppedPath,
	embedded = false,
	idleLabel,
	mode = "single_repo",
	onCloneProject,
	onCreateProject,
	onCreateRepository,
	onInitializeProject,
	openSignal,
	sourceSignal,
}: {
	children?: (state: { choosePath: () => void; disabled: boolean; error: string | null; label: string }) => ReactNode;
	// A folder was dropped on the app window (ShellLayout owns the global
	// listener). Mirrors openSignal but carries a path: skips straight to the
	// mode picker with the native OS dialog step skipped.
	droppedPath?: { path: string; nonce: number } | null;
	// When true, render the Workspace/Project chooser inline (start page) instead
	// of behind a trigger + dialog. Folder validation + agent sheet stay modal.
	embedded?: boolean;
	idleLabel?: string;
	mode?: CreateProjectFlowMode;
	onCloneProject: (input: CloneProjectInput) => Promise<void>;
	onCreateProject: (input: CreateProjectInput) => Promise<void>;
	onCreateRepository: (input: CreateRepositoryInput) => Promise<void>;
	onInitializeProject: (path: string) => Promise<void>;
	// Monotonic counter: each new value opens the flow programmatically (the ⌘N
	// "no project in scope" fallback). Lets the shortcut reuse the sidebar's own
	// create-project flow instead of a separate delegating component.
	openSignal?: number;
	// Home-page action cards: each new nonce jumps straight to clone/local/workspace.
	sourceSignal?: { source: ProjectSource; nonce: number } | null;
}) {
	const daemonStatus = useShellMaybe()?.daemonStatus;
	const isRemote = daemonStatus?.connectionMode === "remote" && daemonStatus.state === "ready";
	const resolvedIdleLabel = idleLabel ?? "New project";
	const [error, setError] = useState<string | null>(null);
	const [modePickerOpen, setModePickerOpen] = useState(false);
	const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
	const [cloneDialogClosing, setCloneDialogClosing] = useState(false);
	const [cloneDetails, setCloneDetails] = useState<CloneRepositoryDetails>(() => ({
		remoteUrl: "",
		destinationParent: isRemote
			? REMOTE_CLONE_DESTINATION_PARENT
			: typeof window === "undefined"
				? ""
				: (window.localStorage.getItem(LAST_CLONE_DESTINATION_KEY) ?? ""),
	}));
	const [cloneSelection, setCloneSelection] = useState<CloneRepositorySelection | null>(null);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createDialogClosing, setCreateDialogClosing] = useState(false);
	const [createDetails, setCreateDetails] = useState<CreateRepositoryDetails>({ name: "", private: true });
	const [createSelection, setCreateSelection] = useState<CreateRepositoryDetails | null>(null);
	const [folderPickerOpen, setFolderPickerOpen] = useState(false);
	const [childTransitioning, setChildTransitioning] = useState(false);
	const [selectedKind, setSelectedKind] = useState<ProjectKind>(mode === "workspace" ? "workspace" : "single_repo");
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [validationScan, setValidationScan] = useState<ImportFolderScan | null>(null);
	const [projectValidation, setProjectValidation] = useState<ImportValidationResult | null>(null);
	const [projectImportStep, setProjectImportStep] = useState<ProjectImportStep | null>(null);
	const [projectPrepEvents, setProjectPrepEvents] = useState<GitPreparationEvent[]>([]);
	const [projectApprovedActions, setProjectApprovedActions] = useState<string[]>([]);
	const [projectRemoteUrl, setProjectRemoteUrl] = useState("");
	const [projectSuggestWorkspace, setProjectSuggestWorkspace] = useState(false);
	const [isChoosingPath, setIsChoosingPath] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [isInitializing, setIsInitializing] = useState(false);
	const [isPreparingGit, setIsPreparingGit] = useState(false);
	const [repositorySetup, setRepositorySetup] = useState<"NOT_A_GIT_REPO" | "PROJECT_UNBORN" | null>(null);
	const [, setRepositorySetupWarning] = useState<string | null>(null);
	// A path that arrived via droppedPath, staged until the user confirms
	// Workspace vs Project. Consumed exactly once by openFolderStep.
	const [pendingDropPath, setPendingDropPath] = useState<string | null>(null);

	const hasModePicker = mode === "choose";
	const projectImportOpen = projectImportStep !== null && projectValidation !== null;
	const isBusy = isChoosingPath || isCreating || isInitializing || isPreparingGit;

	const transitionToChild = (open: () => void) => {
		setChildTransitioning(true);
		window.setTimeout(() => {
			open();
			setChildTransitioning(false);
		}, 80);
	};

	const selectSource = (source: ProjectSource) => {
		if (isRemote && source !== "clone" && source !== "create") return;
		const presetPath = pendingDropPath;
		setPendingDropPath(null);
		setError(null);
		setValidationScan(null);
		setProjectValidation(null);
		setProjectImportStep(null);
		setProjectPrepEvents([]);
		setProjectApprovedActions([]);
		setProjectRemoteUrl("");
		setProjectSuggestWorkspace(false);
		if (source === "clone") {
			if (isRemote) {
				setCloneDetails((prev) => ({ ...prev, destinationParent: REMOTE_CLONE_DESTINATION_PARENT }));
			}
			transitionToChild(() => setCloneDialogOpen(true));
			return;
		}
		if (source === "create") {
			transitionToChild(() => setCreateDialogOpen(true));
			return;
		}
		setCloneSelection(null);
		// Keep the selector mounted behind the native picker. Closing it first
		// exposes a blank compositor frame on Windows before Explorer takes focus.
		void chooseDirectory(source === "workspace" ? "workspace" : "single_repo", presetPath ?? undefined);
	};

	const chooseDirectory = async (kind: ProjectKind, presetPath?: string) => {
		setError(null);
		setValidationScan(null);
		setProjectValidation(null);
		setProjectImportStep(null);
		setProjectPrepEvents([]);
		setProjectApprovedActions([]);
		setProjectRemoteUrl("");
		setProjectSuggestWorkspace(false);
		setRepositorySetup(null);
		setRepositorySetupWarning(null);
		setSelectedKind(kind);
		setIsChoosingPath(true);
		try {
			const path =
				presetPath ??
				(await aoBridge.app.chooseDirectory(
					kind === "workspace" ? "Choose a workspace folder" : "Choose a project repository",
				));
			if (path && kind === "single_repo") {
				const validation = await validateImportFolder(path, "project");
				setProjectValidation(validation);
				setProjectPrepEvents([]);
				setProjectApprovedActions(validation.root.requiredActions);
				setProjectRemoteUrl(validation.root.requiredActions.includes("set_remote") ? suggestedProjectRemoteUrl(validation.root.repoPath) : "");
				setProjectSuggestWorkspace(validation.nextStep === "choose_import_kind");
				if (!validation.isValid || validation.nextStep === "error") {
					setError(importValidationMessage(validation));
					setProjectImportStep("blocked");
					return;
				}
				if (validation.nextStep === "choose_import_kind" || validation.nextStep === "prepare_git") {
					setProjectImportStep("prepare_git");
					return;
				}
			}
			if (path && kind === "workspace") {
				try {
					const warning = await aoBridge.app.checkAncestorRepo(path);
					if (warning) {
						setRepositorySetupWarning(warning);
						setRepositorySetup("NOT_A_GIT_REPO");
					}
				} catch {
					// Ancestor check failed — proceed without warning
				}
			}
			if (path && kind === "workspace" && hasModePicker && !presetPath) {
				try {
					const scan = await aoBridge.app.scanImportFolder({
						path,
						mode: kind === "workspace" ? "workspace" : "project",
					});
					setValidationScan(scan);
					const blockingReason = scan.repos.find(
						(repo) => repo.status === "error" && repo.reason !== "Repository must have at least one commit.",
					)?.reason;
					setError(blockingReason ?? null);
				} catch (err) {
					setValidationScan({ path, repos: [] });
					setError(err instanceof Error ? err.message : "Could not add project");
				}
				transitionToChild(() => setFolderPickerOpen(true));
				return;
			}
			if (path) {
				setModePickerOpen(false);
				setSelectedPath(path);
				setFolderPickerOpen(false);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not add project");
		} finally {
			setIsChoosingPath(false);
		}
	};

	const startFlow = (presetPath?: string) => {
		setPendingDropPath(presetPath ?? null);
		setProjectValidation(null);
		setProjectImportStep(null);
		setProjectPrepEvents([]);
		setProjectApprovedActions([]);
		setProjectRemoteUrl("");
		setProjectSuggestWorkspace(false);
		if (hasModePicker) {
			setError(null);
			setCloneSelection(null);
			setCreateSelection(null);
			setModePickerOpen(true);
			return;
		}
		void chooseDirectory(mode, presetPath);
	};

	// Seed with the current value so we never open on mount; open when it changes.
	const lastOpenSignal = useRef(openSignal);
	useEffect(() => {
		if (openSignal === undefined || openSignal === lastOpenSignal.current) return;
		lastOpenSignal.current = openSignal;
		startFlow();
	}, [openSignal]);

	// A folder was dropped on the app window. Ignored while the flow already has
	// UI on screen so an in-progress manual selection is never silently discarded.
	const lastDropNonce = useRef(droppedPath?.nonce);
	useEffect(() => {
		if (!droppedPath || droppedPath.nonce === lastDropNonce.current) return;
		lastDropNonce.current = droppedPath.nonce;
		if (isRemote) return;
		if (isBusy || modePickerOpen || cloneDialogOpen || createDialogOpen || folderPickerOpen || selectedPath !== null) return;
		startFlow(droppedPath.path);
	}, [droppedPath]);

	const lastSourceNonce = useRef(sourceSignal?.nonce);
	useEffect(() => {
		if (!sourceSignal || sourceSignal.nonce === lastSourceNonce.current) return;
		lastSourceNonce.current = sourceSignal.nonce;
		if (isBusy || modePickerOpen || cloneDialogOpen || createDialogOpen || folderPickerOpen || selectedPath !== null) return;
		selectSource(sourceSignal.source);
	}, [sourceSignal]);

	const createProject = async (selection: CreateProjectAgentSelection) => {
		if (!selectedPath) return;
		setError(null);
		setIsCreating(true);
		try {
			if (cloneSelection) {
				await onCloneProject({
					remoteUrl: cloneSelection.remoteUrl,
					destinationParent: cloneSelection.destinationParent,
					...selection,
				});
				setSelectedPath(null);
				setCloneSelection(null);
				return;
			}
			if (createSelection) {
				await onCreateRepository({
					...createSelection,
					...selection,
				});
				setSelectedPath(null);
				setCreateSelection(null);
				return;
			}
			if (selectedKind === "single_repo" && repositorySetup) {
				setIsInitializing(true);
				await onInitializeProject(selectedPath);
				setRepositorySetup(null);
				setRepositorySetupWarning(null);
				setIsInitializing(false);
			}
			const defaultBranch =
				selectedKind === "single_repo" ? await aoBridge.app.getRepositoryBranch(selectedPath) : undefined;
			await onCreateProject({
				path: selectedPath,
				asWorkspace: selectedKind === "workspace",
				...(defaultBranch ? { defaultBranch } : {}),
				...selection,
			});
			setSelectedPath(null);
		} catch (err) {
			const code = err instanceof Error && "code" in err ? (err.code as string | undefined) : undefined;
			const message = err instanceof Error ? err.message : "Could not add project";
			if (!cloneSelection && selectedKind === "single_repo" && isRepositorySetupRecoveryCode(code)) {
				setRepositorySetup(code);
			}
			setError(message);
			if (cloneSelection || createSelection) {
				// Clone/create submitted from their dialogs: reopen the dialog with the
				// error visible so the user can retry instead of staring at a blank
				// backdrop (there is no agent sheet to fall back to since ADR 0005).
				if (cloneSelection) {
					setCloneSelection(null);
					setCloneDialogOpen(true);
				} else {
					setCreateSelection(null);
					setCreateDialogOpen(true);
				}
				setSelectedPath(null);
			} else if (hasModePicker) {
				if (shouldScanCreateFailure(message)) {
					try {
						const scan = await aoBridge.app.scanImportFolder({
							path: selectedPath,
							mode: selectedKind === "workspace" ? "workspace" : "project",
						});
						setValidationScan(scan);
					} catch {
						setValidationScan({ path: selectedPath, repos: [] });
					}
				} else {
					setValidationScan(null);
				}
				setSelectedPath(null);
				setFolderPickerOpen(true);
			}
		} finally {
			setIsCreating(false);
			setIsInitializing(false);
		}
	};

	// ADR 0005: pi is the only supported harness, so there is no agent choice to
	// collect — submit as soon as a path has been chosen. The submit lock keeps
	// the isCreating/isInitializing handoffs inside createProject from retrig-
	// gering this effect mid-flight; it resets only once the attempt settles.
	const submitLockRef = useRef(false);
	useEffect(() => {
		if (!selectedPath || submitLockRef.current) return;
		submitLockRef.current = true;
		void createProject({ workerAgent: "pi", orchestratorAgent: "pi" }).finally(() => {
			submitLockRef.current = false;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- createProject closes over the batch that set selectedPath
	}, [selectedPath]);

	const reopenSourcePicker = () => {
		setProjectImportStep(null);
		setProjectPrepEvents([]);
		setProjectApprovedActions([]);
		setProjectRemoteUrl("");
		setProjectSuggestWorkspace(false);
		setProjectValidation(null);
		if (hasModePicker) {
			setModePickerOpen(true);
			return;
		}
		setError(null);
	};

	const tryProjectAsWorkspace = () => {
		if (!projectValidation) return;
		setPendingDropPath(projectValidation.root.repoPath);
		setProjectImportStep(null);
		setProjectPrepEvents([]);
		setProjectApprovedActions([]);
		setProjectRemoteUrl("");
		setProjectSuggestWorkspace(false);
		setProjectValidation(null);
		setError(null);
		setSelectedKind("workspace");
		setModePickerOpen(true);
	};

	const prepareProjectGit = async () => {
		if (!projectValidation) return;
		setError(null);
		setProjectPrepEvents(projectRequestedActionEvents(projectValidation.root.repoPath, projectApprovedActions));
		setIsPreparingGit(true);
		try {
			const { data, error: apiError } = await apiClient.POST("/api/v1/imports/prepare-git", {
				body: {
					importKind: "project",
					path: projectValidation.root.repoPath,
					approvedActions: projectApprovedActions,
					remoteUrl: projectRemoteUrl.trim() || undefined,
				},
			});
			if (apiError || !data) throw new Error(apiErrorMessage(apiError, "Could not add project"));
			setProjectPrepEvents(data.events);
			setProjectValidation(data.validation);
			setProjectApprovedActions(data.validation.root.requiredActions);
			if (projectRemoteUrl.trim() !== "") persistSuggestedProjectRemoteUrl(projectRemoteUrl);
			const failed = data.events.find((event) => event.state === "error");
			if (failed) {
				setError(projectPreparationFailureMessage(failed));
				return;
			}
			if (!data.validation.isValid || data.validation.nextStep === "error") {
				setError(importValidationMessage(data.validation));
				setProjectImportStep("blocked");
				setProjectSuggestWorkspace(false);
				return;
			}
			if (data.validation.nextStep === "continue") {
				setProjectImportStep(null);
				setProjectSuggestWorkspace(false);
				setSelectedPath(data.validation.root.repoPath);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not add project");
		} finally {
			setIsPreparingGit(false);
		}
	};

	const label = isInitializing
		? hasModePicker
			? "Initializing..."
			: "Setting up..."
		: isPreparingGit
			? "Setting up..."
		: isCreating
			? "Creating..."
			: resolvedIdleLabel;

	return (
		<>
			{!embedded &&
				children?.({
					// Zero-arg wrapper: callers wire this directly to onClick, whose
					// SyntheticEvent would otherwise be forwarded as startFlow's
					// presetPath and get treated as a dropped path.
					choosePath: () => startFlow(),
					disabled: isBusy,
					error,
					label,
				})}
			<CreateProjectFlowBackdrop open={modePickerOpen || cloneDialogOpen || createDialogOpen || folderPickerOpen || selectedPath !== null || childTransitioning} />
			{hasModePicker && embedded && !modePickerOpen && !cloneDialogOpen && !createDialogOpen && selectedPath === null && (
				<div className="flex w-full flex-col items-center gap-3">
					<ImportSourcePicker disabled={isBusy} onSelect={selectSource} />
					{error && !folderPickerOpen && selectedPath === null && (
						<p className="text-caption leading-body text-error" role="status">
							{error}
						</p>
					)}
				</div>
			)}
			{hasModePicker && (
				<>
					<CreateProjectSourceDialog
						childOpen={childTransitioning || cloneDialogOpen || createDialogOpen || folderPickerOpen}
						disabled={isBusy}
						open={modePickerOpen}
						onOpenChange={(open) => {
							if (isBusy) return;
							setModePickerOpen(open);
							// Dismissed without picking a kind — don't let a stale dropped
							// path hijack the next manual "New Project" click, and reopen
							// on the default Local choice.
							if (!open) {
								setPendingDropPath(null);
							}
						}}
						onSelect={selectSource}
					/>
					{cloneDialogOpen || cloneDialogClosing ? (
						<CloneRepositoryDialog
							disabled={isBusy}
							error={error}
							lockDestinationParent={isRemote ? REMOTE_CLONE_DESTINATION_PARENT : undefined}
							onBack={() => {
								setError(null);
								setCloneDialogOpen(false);
								setModePickerOpen(true);
							}}
							onChange={(next) => {
								setCloneDetails(next);
								setError(null);
							}}
							onClose={() => {
								setCloneDialogOpen(false);
								setError(null);
							}}
							onContinue={(next) => {
								setCloneSelection(next);
								setSelectedKind("single_repo");
								setModePickerOpen(false);
								setCloneDialogOpen(false);
								setCloneDialogClosing(true);
								setChildTransitioning(true);
								setCloneDialogOpen(false);
								window.setTimeout(() => {
									setCloneDialogClosing(false);
									setSelectedPath(next.targetPath);
									setChildTransitioning(false);
								}, 80);
							}}
							open={cloneDialogOpen}
							value={cloneDetails}
						/>
					) : null}
					{createDialogOpen || createDialogClosing ? (
						<CreateRepositoryDialog
							disabled={isBusy}
							error={error}
							onBack={() => {
								setError(null);
								setCreateDialogOpen(false);
								setModePickerOpen(true);
							}}
							onChange={(next) => {
								setCreateDetails(next);
								setError(null);
							}}
							onClose={() => {
								setCreateDialogOpen(false);
								setError(null);
							}}
							onContinue={(next) => {
								setCreateSelection(next);
								setSelectedKind("single_repo");
								setModePickerOpen(false);
								setCreateDialogOpen(false);
								setCreateDialogClosing(true);
								setChildTransitioning(true);
								window.setTimeout(() => {
									setCreateDialogClosing(false);
									setSelectedPath(next.name);
									setChildTransitioning(false);
								}, 80);
							}}
							open={createDialogOpen}
							value={createDetails}
						/>
					) : null}
					<CreateProjectFolderDialog
						disabled={isBusy}
						error={error}
						kind={selectedKind}
						open={folderPickerOpen}
						scan={validationScan}
						onContinue={() => {
							if (!validationScan || error) return;
							setFolderPickerOpen(false);
							setSelectedPath(validationScan.path);
							setModePickerOpen(false);
						}}
						onBack={() => {
							setError(null);
							setValidationScan(null);
							setFolderPickerOpen(false);
						}}
						onChooseFolder={() => void chooseDirectory(selectedKind)}
						onOpenChange={(open) => {
							if (!isBusy) {
								setFolderPickerOpen(open);
								if (!open) {
									setError(null);
									setValidationScan(null);
								}
							}
						}}
					/>
				</>
			)}
			<ProjectImportDialog
				disabled={isBusy}
				error={error}
				approvedActions={projectApprovedActions}
				onBack={reopenSourcePicker}
				onChangeApprovedActions={setProjectApprovedActions}
				onChangeFolder={() => void chooseDirectory("single_repo")}
				onChangeRemote={setProjectRemoteUrl}
				onContinue={() => void prepareProjectGit()}
				onOpenChange={(open) => {
					if (isBusy) return;
					if (!open) {
						setProjectImportStep(null);
						setProjectPrepEvents([]);
						setProjectApprovedActions([]);
						setProjectRemoteUrl("");
						setProjectSuggestWorkspace(false);
						setProjectValidation(null);
						setError(null);
					}
				}}
				onTryWorkspace={tryProjectAsWorkspace}
				open={projectImportOpen}
				remoteUrl={projectRemoteUrl}
				suggestWorkspace={projectSuggestWorkspace}
				step={projectImportStep}
				isPreparingGit={isPreparingGit}
				events={projectPrepEvents}
				validation={projectValidation}
			/>
			
			{error && !hasModePicker && (
				<span className="sr-only" role="status">
					{error}
				</span>
			)}
		</>
	);
}

function isRepositorySetupRecoveryCode(code: string | undefined): code is "NOT_A_GIT_REPO" | "PROJECT_UNBORN" {
	return code === "NOT_A_GIT_REPO" || code === "PROJECT_UNBORN";
}

async function validateImportFolder(path: string, importKind: "project" | "workspace"): Promise<ImportValidationResult> {
	const { data, error } = await apiClient.POST("/api/v1/imports/validate", { body: { importKind, path } });
	if (error || !data) throw new Error(apiErrorMessage(error, "Could not validate this folder."));
	return data;
}

function importValidationMessage(result: ImportValidationResult): string {
	if (result.blockingErrors.length === 0) return "This folder cannot be imported yet.";
	return result.blockingErrors.map(importBlockingErrorLabel).join(" ");
}

function importBlockingErrorLabel(code: string): string {
	switch (code) {
		case "INVALID_PATH":
			return "Choose a folder AO can read.";
		case "PATH_NOT_DIRECTORY":
			return "Choose a folder, not a file.";
		case "BARE_REPOSITORY":
			return "Choose a normal working checkout instead of a bare Git repository.";
		case "UNSUPPORTED_GIT_METADATA":
			return "Repair the Git metadata or choose a different folder.";
		case "CHILD_REPO_SCAN_FAILED":
			return "AO could not inspect the repositories under this folder.";
		case "IMPORT_PATH_UNSAFE":
			return "Choose a specific project folder outside AO's own state directories.";
		default:
			return "Choose a different folder or repair the repository before continuing.";
	}
}

function gitActionLabel(action: string): string {
	switch (action) {
		case "git_init":
			return "Git initialization";
		case "git_commit":
			return "Initial commit";
		case "set_remote":
			return "Remote setup";
		default:
			return "Git setup";
	}
}

function gitActionDescription(action: string): string {
	switch (action) {
		case "git_init":
			return "Create a Git repository in this folder.";
		case "git_commit":
			return "Create the first commit so the project has a usable history.";
		case "set_remote":
			return "Configure the origin remote for this repository.";
		default:
			return "Apply the required repository setup.";
	}
}

function latestProjectActionState(action: string, events: GitPreparationEvent[]): string {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index]?.action === action) return events[index].state;
	}
	return "required";
}

function orderedProjectActions(actions: string[]): string[] {
	const rank = new Map([
		["git_init", 0],
		["git_commit", 1],
		["set_remote", 2],
	]);
	return [...actions].sort((left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER));
}

function projectRequestedActionEvents(repoPath: string, actions: string[]): GitPreparationEvent[] {
	const ordered = orderedProjectActions(actions);
	return ordered.map((action, index) => ({
		repoPath,
		action: action as GitPreparationEvent["action"],
		state: index === 0 ? "running" : "pending",
	}));
}

function suggestedProjectRemoteUrl(repoPath: string): string {
	if (typeof window === "undefined") return "";
	const repoName = repoPath.split(/[\\/]/).filter(Boolean).pop()?.trim();
	const saved = window.localStorage.getItem(LAST_IMPORT_REMOTE_URL_KEY)?.trim() ?? "";
	if (!repoName) return saved;
	const withGitSuffix = repoName.endsWith(".git") ? repoName : `${repoName}.git`;
	if (saved === "") return `https://github.com/username/${withGitSuffix}`;
	const sshMatch = saved.match(/^(git@[^:]+:[^/]+\/)([^/]+?)(\.git)?$/);
	if (sshMatch) return `${sshMatch[1]}${withGitSuffix}`;
	try {
		const parsed = new URL(saved);
		const segments = parsed.pathname.split("/").filter(Boolean);
		if (segments.length >= 2) {
			segments[segments.length - 1] = withGitSuffix;
			parsed.pathname = `/${segments.join("/")}`;
			return parsed.toString();
		}
	} catch {
		return `https://github.com/username/${withGitSuffix}`;
	}
	return `https://github.com/username/${withGitSuffix}`;
}

function persistSuggestedProjectRemoteUrl(remoteUrl: string) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(LAST_IMPORT_REMOTE_URL_KEY, remoteUrl.trim());
}

function projectPreparationFailureMessage(event: GitPreparationEvent): string {
	return `${displayImportPath(event.repoPath)} failed while running ${gitActionLabel(event.action)}. Review the step below, then retry or go back.`;
}

function shouldScanCreateFailure(message: string): boolean {
	if (/daemon|server|conflict|already exists|not ready|start|orchestrator|permission denied/i.test(message))
		return false;
	if (/\b(?:PATH|ID)_ALREADY_REGISTERED\b/i.test(message) || /already registered/i.test(message)) return false;
	return /workspace|repo|repository|git|path|folder|worktree|bare|branch|commit|remote/i.test(message);
}

function CreateProjectFlowBackdrop({ open }: { open: boolean }) {
	return (
		<Dialog.Root open={open}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-overlay bg-black/55 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out motion-reduce:animate-none" />
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function CreateProjectSourceDialog({
	childOpen,
	disabled,
	onOpenChange,
	onSelect,
	open,
}: {
	childOpen: boolean;
	disabled: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (source: ProjectSource) => void;
	open: boolean;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Content
					hidden={childOpen}
					className={cn(
						"fixed left-1/2 top-1/2 z-overlay w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0 shadow-none outline-none motion-reduce:animate-none",
						childOpen
							? "pointer-events-none opacity-0 animate-modal-out"
							: "data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out",
					)}
				>
					<Dialog.Title className="sr-only">{"Add a project"}</Dialog.Title>
					<Dialog.Description className="sr-only">{"Choose how you want to add code to Agent Orchestrator"}</Dialog.Description>
					<div className="flex w-full flex-col items-center gap-3">
						<ImportSourcePicker disabled={disabled} onClose={() => onOpenChange(false)} onSelect={onSelect} dialog />
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function ImportSourcePicker({
	dialog = false,
	disabled,
	onClose,
	onSelect,
}: {
	dialog?: boolean;
	disabled: boolean;
	onClose?: () => void;
	onSelect: (source: ProjectSource) => void;
}) {
	const daemonStatus = useShellMaybe()?.daemonStatus;
	const isRemote = daemonStatus?.connectionMode === "remote" && daemonStatus.state === "ready";
	const sources: Array<{ source: ProjectSource; icon: ReactNode; label: string; description: string }> = [
		{
			source: "create",
			icon: <FolderPlus className="size-5" aria-hidden="true" strokeWidth={1.8} />,
			label: "Create a new Git repository",
			description: "Create a private GitHub repository and check it out on the AO server",
		},
		{
			source: "clone",
			icon: <GitFork className="size-5" aria-hidden="true" strokeWidth={1.8} />,
			label: "Clone from Git",
			description: "Start from a remote repository using an HTTPS or SSH URL",
		},
		...(!isRemote
			? [
					{
						source: "local" as const,
						icon: <FolderClosed className="size-5" aria-hidden="true" strokeWidth={1.8} />,
						label: "Import an existing project",
						description: "Use a project that is already on this computer",
					},
					{
						source: "workspace" as const,
						icon: <Folders className="size-5" aria-hidden="true" strokeWidth={1.8} />,
						label: "Import a workspace folder",
						description: "Several projects that live under one parent folder",
					},
				]
			: []),
	];
	return (
		<div className="relative w-full max-w-[520px] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
			{dialog ? (
				<Dialog.Title className="settings-dialog-title px-4 pt-3">{"Add a project"}</Dialog.Title>
			) : (
				<h2 className="settings-dialog-title px-4 pt-3">{"Add a project"}</h2>
			)}
			{dialog ? (
				<Dialog.Description className="px-4 pb-3 pt-1 text-[13px] leading-5 text-muted-foreground">
					{"Choose how you want to add code to Agent Orchestrator"}
				</Dialog.Description>
			) : (
				<p className="px-4 pb-3 pt-1 text-[13px] leading-5 text-muted-foreground">
					{"Choose how you want to add code to Agent Orchestrator"}
				</p>
			)}
			<div className="mx-4 mb-4 overflow-hidden rounded-md border border-border/50 bg-[var(--color-bg-import-modal)]">
				<div className="flex flex-col divide-y divide-border/50">
				{sources.map(({ source, icon, label, description }) => (
					<button
						key={source}
						type="button"
						className="group flex min-h-[76px] items-center gap-3 px-3.5 py-3 text-left hover:bg-accent/50 active:bg-accent disabled:pointer-events-none disabled:opacity-50"
						aria-label={label}
						disabled={disabled}
						onClick={() => onSelect(source)}
					>
						<span className="grid w-9 shrink-0 place-items-center text-muted-foreground group-hover:text-foreground">
							{icon}
						</span>
						<span className="min-w-0">
							<span className="block text-[14px] font-medium text-foreground">{label}</span>
							<span className="mt-0.5 block text-[12px] leading-5 text-muted-foreground">{description}</span>
						</span>
					</button>
				))}
				</div>
			</div>
			{dialog && onClose ? (
				<button
					type="button"
					className="settings-close-button absolute right-3 top-3"
					aria-label={"Close new project dialog"}
					disabled={disabled}
					onClick={onClose}
				>
					<X className="size-4" aria-hidden="true" />
				</button>
			) : null}
		</div>
	);
}

function ProjectImportDialog({
	approvedActions,
	disabled,
	error,
	events,
	onBack,
	onChangeApprovedActions,
	onChangeFolder,
	onChangeRemote,
	onContinue,
	onOpenChange,
	onTryWorkspace,
	open,
	remoteUrl,
	suggestWorkspace,
	step,
	isPreparingGit,
	validation,
}: {
	approvedActions: string[];
	disabled: boolean;
	error: string | null;
	events: GitPreparationEvent[];
	onBack: () => void;
	onChangeApprovedActions: (actions: string[]) => void;
	onChangeFolder: () => void;
	onChangeRemote: (value: string) => void;
	onContinue: () => void;
	onOpenChange: (open: boolean) => void;
	onTryWorkspace: () => void;
	open: boolean;
	remoteUrl: string;
	suggestWorkspace: boolean;
	step: ProjectImportStep | null;
	isPreparingGit: boolean;
	validation: ImportValidationResult | null;
}) {
	if (!validation || !step) return null;
	const needsRemote = validation.root.requiredActions.includes("set_remote");
	const hasChildRepos = (validation.childRepos?.length ?? 0) > 0;
	const hasFailedStep = events.some((event) => event.state === "error");
	const missingApprovals = validation.root.requiredActions.filter((action) => !approvedActions.includes(action));
	const continueDisabled = disabled || missingApprovals.length > 0 || (needsRemote && remoteUrl.trim() === "");
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-overlay bg-black/55 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out motion-reduce:animate-none" />
				<Dialog.Content
					className="fixed left-1/2 top-1/2 z-overlay flex max-h-[min(700px,calc(100svh-24px))] w-[min(680px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-modal)] p-0 text-[var(--color-text-import-title)] shadow-[var(--shadow-import-modal)] data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out motion-reduce:animate-none"
					onInteractOutside={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<div className="flex items-start gap-3 border-b border-[var(--color-border-import-modal)] px-4 py-3">
						<Button type="button" variant="outline" size="icon" aria-label={"Back to import source"} disabled={disabled} onClick={onBack}>
							<ChevronRight className="size-4 rotate-180" aria-hidden="true" />
						</Button>
						<div className="min-w-0 flex-1">
							<Dialog.Title className="text-[18px] font-semibold text-[var(--color-text-import-title)]">
								{step === "prepare_git" ? "Prepare project" : "Import project"}
							</Dialog.Title>
							<Dialog.Description className="mt-1 text-[13px] leading-5 text-[var(--color-text-import-muted)]">
								{step === "blocked"
									? "AO found a problem with this folder before project setup can continue."
									: "AO needs your approval before it initializes Git, creates a first commit, or sets the origin remote."}
							</Dialog.Description>
						</div>
						<Dialog.Close asChild>
							<button type="button" className="settings-close-button" aria-label={"Close project import dialog"} disabled={disabled}>
								<X className="size-4" aria-hidden="true" />
							</button>
						</Dialog.Close>
					</div>
					<div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
						<div className="flex items-center gap-3 rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] px-3 py-2.5">
							<Folder className="size-4 shrink-0 text-[var(--color-text-import-muted)]" aria-hidden="true" />
							<div className="min-w-0 flex-1">
								<div className="truncate font-mono text-[13px] font-semibold text-[var(--color-text-import-title)]">
									{displayImportPath(validation.root.repoPath)}
								</div>
								<div className="mt-0.5 text-[11px] text-[var(--color-text-import-muted)]">{"Project folder"}</div>
							</div>
							<Button type="button" variant="outline" disabled={disabled} onClick={onChangeFolder}>
								{"Change"}
							</Button>
						</div>
						{hasChildRepos ? (
							<div className="rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-import-muted)]">
								{"Contains child Git repos. Import as workspace if AO should keep them separate."}
							</div>
						) : null}
						{validation.warning ? (
							<div className="rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] px-3 py-3 text-[12px] leading-5 text-[var(--color-text-import-muted)]">
								{validation.warning}
							</div>
						) : null}
						{error ? (
							<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-[12px] leading-5 text-destructive" role="alert">
								{error}
							</div>
						) : null}
						{suggestWorkspace ? (
							<div className="rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] px-4 py-3 text-[13px] leading-5 text-[var(--color-text-import-muted)]">
								{"Try importing this folder as a workspace if you want AO to treat the child repositories as separate projects. Continue as project if you want AO to initialize only the selected root folder."}
							</div>
						) : null}
						{step === "prepare_git" ? (
							<section className="space-y-3">
								<div className="rounded-lg border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] px-4 py-4">
									<h3 className="text-[13px] font-semibold text-[var(--color-text-import-title)]">{"Project setup"}</h3>
									<p className="mt-1 text-[12px] leading-5 text-[var(--color-text-import-muted)]">
										{"Approve the required setup actions for this folder. AO will run only the selected required steps before continuing."}
									</p>
									{isPreparingGit ? (
										<p className="mt-3 text-[12px] leading-5 text-[var(--color-text-import-title)]">
											{"Running project setup. AO is preparing this repository now."}
										</p>
									) : null}
									<div className="mt-3 space-y-3">
										{validation.root.requiredActions.map((action) => {
											const state = latestProjectActionState(action, events);
											const checked = approvedActions.includes(action);
											const statusLabel =
												state === "required"
													? action === "set_remote"
														? "Set URL"
														: "Ready"
													: state === "pending"
														? "Queued"
														: state === "running"
															? "Running"
															: state === "success"
																? "Done"
																: "Failed";
											const tone =
												state === "success"
													? "text-success"
													: state === "error"
														? "text-destructive"
														: state === "running"
															? "text-[var(--color-text-import-title)]"
															: state === "pending"
																? "text-[var(--color-text-import-muted)]"
																: "text-[var(--color-text-import-muted)]";
											return (
												<label
													key={action}
													className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-modal)] px-3 py-3"
												>
													<input
														type="checkbox"
														className="mt-0.5 size-4 rounded border-border"
														checked={checked}
														disabled={disabled}
														onChange={(event) =>
															onChangeApprovedActions(
																event.target.checked
																	? [...approvedActions, action]
																	: approvedActions.filter((value) => value !== action),
															)
														}
													/>
													<span className="min-w-0 flex-1">
														<span className="block text-[13px] font-medium text-[var(--color-text-import-title)]">
															{gitActionLabel(action)}
														</span>
														<span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-import-muted)]">
															{gitActionDescription(action)}
														</span>
														{action === "set_remote" ? (
															<span className="mt-3 block space-y-2">
																<Label
																	htmlFor="projectImportRemote"
																	className="text-[12px] font-semibold text-[var(--color-text-import-title)]"
																>
																	{"Origin remote URL"}
																</Label>
																<Input
																	id="projectImportRemote"
																	autoCapitalize="none"
																	autoComplete="off"
																	className="bg-[var(--color-bg-import-card)] font-mono text-[13px]"
																	disabled={disabled}
																	placeholder={"https://github.com/org/repository.git"}
																	spellCheck={false}
																	value={remoteUrl}
																	onChange={(event) => onChangeRemote(event.target.value)}
																/>
																<span className="block rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-[var(--color-text-import-title)]">
																	{"To create sessions and PRs successfully, make sure this repository also exists on GitHub and that you can push the default branch to it."}
																</span>
															</span>
														) : null}
													</span>
													<span className={cn("shrink-0 text-[12px] font-medium capitalize", tone)}>
														{statusLabel}
													</span>
												</label>
											);
										})}
									</div>
									{missingApprovals.length > 0 ? (
										<p className="mt-4 text-[12px] leading-5 text-[var(--color-text-import-muted)]">
											{"Approve all required setup actions to continue importing this project."}
										</p>
									) : null}
								</div>
							</section>
						) : null}
					</div>
					<div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border-import-modal)] px-4 py-4">
						{step === "blocked" ? (
							<>
								<Button type="button" variant="outline" disabled={disabled} onClick={onBack}>
									{"Back"}
								</Button>
								<Button type="button" variant="primary" disabled={disabled} onClick={onChangeFolder}>
									{"Choose another folder"}
								</Button>
							</>
						) : null}
						{step === "prepare_git" ? (
							<>
								{suggestWorkspace ? (
									<Button type="button" variant="outline" disabled={disabled} onClick={onTryWorkspace}>
										{"Try importing as workspace"}
									</Button>
								) : null}
								<Button type="button" variant="outline" disabled={disabled} onClick={onBack}>
									{"Back"}
								</Button>
								<Button type="button" variant="primary" disabled={continueDisabled} onClick={onContinue}>
									{hasFailedStep ? "Retry" : "Continue"}
								</Button>
							</>
						) : null}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function CreateProjectFolderDialog({
	disabled,
	error,
	kind,
	onBack,
	onChooseFolder,
	onContinue,
	onOpenChange,
	open,
	scan,
}: {
	disabled: boolean;
	error: string | null;
	kind: ProjectKind;
	onBack: () => void;
	onChooseFolder: () => void;
	onContinue: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	scan: ImportFolderScan | null;
}) {
	const isWorkspace = kind === "workspace";
	const failedRepos =
		scan?.repos.filter(
			(repo) =>
				(repo.status === "error" || !repo.hasRemote) &&
				!repo.needsGitInit &&
				repo.reason !== "Repository must have at least one commit.",
		) ?? [];
	const hasScan = scan !== null;
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Content className="fixed left-1/2 top-1/2 z-overlay flex max-h-[min(640px,calc(100svh-24px))] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-xl data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out motion-reduce:animate-none">
					<div className="relative shrink-0 px-4 pt-3">
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={"Back to import type"}
							disabled={disabled}
							onClick={onBack}
						>
							<ChevronRight className="size-4 rotate-180" aria-hidden="true" />
						</Button>
						<div className="min-w-0 flex-1 pr-8">
							<Dialog.Title className="text-[18px] font-semibold text-[var(--color-text-import-title)]">
								{isWorkspace ? "Import workspace" : "Import project"}
							</Dialog.Title>
							<Dialog.Description className="sr-only">
								{isWorkspace ? "Pick a folder that contains your Git repositories. Each repo inside it joins the workspace." : "Import a single Git repository as one project."}
							</Dialog.Description>
						</div>
						<Dialog.Close asChild>
							<button
								type="button"
								className="settings-close-button"
								aria-label={"Close import dialog"}
								disabled={disabled}
							>
								<X className="size-4" aria-hidden="true" />
							</button>
						</Dialog.Close>
					</div>
					<div className="min-h-0 overflow-y-auto px-4 pb-1 pt-3">
						{hasScan ? (
							<div className="space-y-3">
								<div className="flex items-center gap-3 rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] px-3 py-2.5">
									<Folder className="size-4 shrink-0 text-[var(--color-text-import-muted)]" aria-hidden="true" />
									<div className="min-w-0 flex-1">
										<div className="truncate font-mono text-[13px] font-semibold text-[var(--color-text-import-title)]">
											{displayImportPath(scan.path)}
										</div>
										<div className="mt-0.5 text-[11px] text-[var(--color-text-import-muted)]">
											{isWorkspace ? "Workspace root" : "Project folder"}
										</div>
									</div>
									<Button type="button" variant="outline" disabled={disabled} onClick={onChooseFolder}>
										{"Change"}
									</Button>
								</div>

								{error && (
									<div className="rounded-lg border border-destructive/40 bg-destructive/10">
										<div className="border-b border-destructive/30 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-destructive">
											<span className="mr-2 inline-block size-2 rounded-full bg-destructive" aria-hidden="true" />
											{isWorkspace ? "Import failed · workspace not registered" : "Import failed · project not registered"}
										</div>
						<div className="px-3 py-2 text-[12px] leading-5 text-destructive">{error}</div>
						<div className="border-t border-destructive/30 px-3 py-2 text-[12px] text-[var(--color-text-import-muted)]">
							{"Review the error above or choose a different folder"}
						</div>
										{failedRepos.length > 0 && (
											<div className="border-t border-destructive/30">
									{failedRepos.map((repo) => (
										<ImportRepoRow key={repo.path} repo={repo} failed />
									))}
									<div className="border-t border-destructive/30 px-3 py-2 text-[12px] text-[var(--color-text-import-muted)]">
										{(failedRepos.length) === 1 ? `Resolve ${failedRepos.length} failed repository to continue` : `Resolve ${failedRepos.length} failed repositories to continue`}
									</div>
								</div>
										)}
									</div>
								)}

							{scan.repos
								.filter((repo) => (repo.status !== "error" && repo.hasRemote) || repo.needsGitInit)
								.map((repo) => (
										<div
											key={repo.path}
											className="rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)]"
										>
											<ImportRepoRow repo={repo} />
										</div>
									))}

								{scan.repos.length === 0 && (
									<div className="rounded-md border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] p-3 text-[12px] text-[var(--color-text-import-muted)]">
										{"No repositories detected in this folder."}
									</div>
								)}
							</div>
						) : (
							<button
								type="button"
								className="flex min-h-[132px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] p-6 text-center transition-colors hover:bg-[var(--color-bg-import-card-hover)] disabled:pointer-events-none disabled:opacity-50 sm:min-h-[160px]"
								disabled={disabled}
								onClick={onChooseFolder}
							>
								<span className="mb-4 grid size-11 place-items-center rounded-xl bg-[var(--color-bg-import-chip)] text-[var(--color-text-import-muted)]">
									<FolderPlus className="size-5" aria-hidden="true" />
								</span>
								<span className="text-[15px] font-semibold text-[var(--color-text-import-title)]">
									{isWorkspace ? "Choose a folder" : "Choose a project folder"}
								</span>
								<span className="mt-2 max-w-full text-pretty text-[12px] text-[var(--color-text-import-muted)] sm:text-[13px]">
									{isWorkspace ? "Opens your system file picker — pick the folder that holds your repos" : "Opens your system file picker — select one repo folder"}
								</span>
							</button>
						)}
						{error && !hasScan && (
							<div
								className={cn(
									"mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-[12px] leading-5 text-destructive",
								)}
							>
								{error}
							</div>
						)}
					</div>
					<div className="flex shrink-0 justify-end gap-2 px-4 pb-4 pt-3">
						<div className="flex flex-wrap items-center justify-end gap-3">
							<Button type="button" variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
								{"Cancel"}
							</Button>
							{hasScan && failedRepos.length === 0 && !error && (
								<Button type="button" variant="primary" disabled={disabled} onClick={onContinue}>
									{"Continue"}
								</Button>
							)}
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function ImportRepoRow({ failed = false, repo }: { failed?: boolean; repo: ImportFolderScan["repos"][number] }) {
	return (
		<div className="flex items-center gap-3 px-3 py-2.5">
			{failed ? (
				<XCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
			) : repo.needsGitInit ? (
				<CircleDashed className="size-4 shrink-0 text-[var(--color-text-import-muted)]" aria-hidden="true" />
			) : (
				<CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
			)}
			<div className="min-w-0 flex-1">
				<div className="truncate text-[14px] font-semibold text-[var(--color-text-import-title)]">{repo.name}</div>
				<div className="mt-0.5 truncate font-mono text-[12px] text-[var(--color-text-import-muted)]">
					{displayImportPath(repo.path)}
				</div>
			</div>
			<div className="hidden max-w-[260px] shrink-0 truncate text-right font-mono text-[12px] text-[var(--color-text-import-muted)] sm:block">
				{repo.needsGitInit
					? "Needs git init"
					: failed
						? (repo.reason ?? "Repository cannot be imported")
						: `${repo.branch} ${remoteDisplay(repo.remote)}`}
			</div>
		</div>
	);
}

function displayImportPath(value: string) {
	return value.replace(/^\/Users\/[^/]+/, "~");
}

function remoteDisplay(remote: string) {
	const ssh = remote.match(/^[^@]+@([^:]+):(.+)$/);
	if (ssh?.[1] && ssh[2]) return `${ssh[1]}/${ssh[2].replace(/\.git$/, "")}`;
	try {
		const url = new URL(remote);
		return `${url.host}${url.pathname.replace(/\.git$/, "")}`;
	} catch {
		return remote.replace(/^https?:\/\//, "").replace(/\.git$/, "");
	}
}
