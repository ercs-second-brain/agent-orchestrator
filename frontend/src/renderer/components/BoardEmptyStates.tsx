import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShell } from "../lib/shell-context";
import { CreateProjectFlow } from "./CreateProjectFlow";
import { TopbarButton } from "./TopbarButton";
import { WelcomePanel } from "./WelcomePanel";
import { OrchestratorIcon } from "./icons";

// Board empty states: first-launch welcome (`BoardWelcome`) and project board
// with no worker sessions yet (`ProjectBoardEmpty`).
export function BoardWelcome() {
	const { cloneProject, createProject, createRepository, initializeProjectRepository } = useShell();
	return (
		<WelcomePanel>
			<div
				className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 py-8"
				data-testid="board-welcome"
			>
				<CreateProjectFlow
					embedded
					mode="choose"
					onCloneProject={cloneProject}
					onCreateProject={createProject}
					onCreateRepository={createRepository}
					onInitializeProject={initializeProjectRepository}
				/>
			</div>
		</WelcomePanel>
	);
}

// Project board with a registered project but no worker sessions yet: a quiet
// invitation instead of four empty columns. Actions mirror the board header
// (Orchestrator stays the primary, like the topbar) so the vocabulary holds.
export function ProjectBoardEmpty({
	hasOrchestrator,
	isProjectRestarting,
	isSpawning,
	onNewTask,
	onOpenOrchestrator,
	onOpenOrchestratorAsTui,
	spawnError,
}: {
	hasOrchestrator: boolean;
	isProjectRestarting: boolean;
	isSpawning: boolean;
	onNewTask: () => void;
	onOpenOrchestrator: () => void;
	onOpenOrchestratorAsTui?: () => void;
	spawnError?: string | null;
}) {
	const orchestratorLabel = hasOrchestrator ? "Orchestrator" : "Spawn Orchestrator";
	const busyLabel = isProjectRestarting
		? "Restarting..."
		: isSpawning
			? "Spawning..."
			: orchestratorLabel;

	return (
		<div className="flex h-full min-h-0 items-center justify-center overflow-y-auto">
			<div className="flex w-full max-w-preview-content flex-col items-center pb-empty-offset-y text-center">
				<h2 className="text-subtitle font-semibold tracking-tight text-foreground">{"No worker sessions yet"}</h2>
				<p className="mt-2 text-md-sm leading-relaxed text-muted-foreground">{"Describe a task and the orchestrator plans it, spawns worker sessions, and tracks them here as work moves forward."}</p>
				<div className="mt-5 flex items-center gap-2">
					<TopbarButton
						aria-label={orchestratorLabel}
						disabled={isSpawning || isProjectRestarting}
						onClick={onOpenOrchestrator}
						variant="primary"
					>
						<OrchestratorIcon className="size-icon-md" aria-hidden="true" />
						{busyLabel}
					</TopbarButton>
					<TopbarButton aria-label={"New task"} disabled={isProjectRestarting} onClick={onNewTask} variant="accent">
						<Plus className="size-icon-md" aria-hidden="true" />
						{"New task"}
					</TopbarButton>
				</div>
				{spawnError && (
					<div className="mt-3 flex flex-col items-center gap-2">
						<p className="text-caption leading-body text-error" role="status">
							{spawnError}
						</p>
						{onOpenOrchestratorAsTui ? (
							<TopbarButton disabled={isSpawning || isProjectRestarting} onClick={onOpenOrchestratorAsTui}>
								{"Create as Terminal UI"}
							</TopbarButton>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
