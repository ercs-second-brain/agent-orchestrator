import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { useState } from "react";
import { useWorkspaceScope } from "../hooks/useWorkspaceQuery";
import { spawnOrchestrator } from "../lib/spawn-orchestrator";
import { useUiStore } from "../stores/ui-store";
import { hasConfiguredOrchestratorAgent, isOrchestratorSession } from "../types/workspace";
import type { WorkspaceSession } from "../types/workspace";
import { Button } from "./ui/button";
import {
	settingsDialogBodyClass,
	settingsDialogContentClass,
	settingsDialogFooterClass,
	settingsDialogHeaderClass,
} from "./ui/dialog";

type RestoreUnavailableDialogProps = {
	open: boolean;
	session: WorkspaceSession;
	onOpenChange: (open: boolean) => void;
	onRecreated: (newOrchestratorId: string) => void;
};

export function RestoreUnavailableDialog({ open, session, onOpenChange, onRecreated }: RestoreUnavailableDialogProps) {
	const workspaceQuery = useWorkspaceScope(session.workspaceId);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const orchestrator = isOrchestratorSession(session);
	const workspace = workspaceQuery.data?.project;
	const hasOrchestratorAgent = hasConfiguredOrchestratorAgent(workspace);
	const checkingProject = workspaceQuery.isLoading && workspaceQuery.data === undefined;

	const recreate = async () => {
		if (checkingProject) return;
		if (!hasOrchestratorAgent) {
			onOpenChange(false);
			useUiStore.getState().openProjectSettings(session.workspaceId);
			return;
		}
		setBusy(true);
		setError(undefined);
		try {
			const id = await spawnOrchestrator(session.workspaceId, "restore_dialog", true);
			onOpenChange(false);
			onRecreated(id);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create orchestrator");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="dialog-overlay data-[state=open]:animate-overlay-in" />
				<Dialog.Content
					className={`${settingsDialogContentClass} fixed left-1/2 top-1/2 w-dialog-md -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-modal-in`}
				>
					<button
						type="button"
						className="settings-dialog-close-button settings-close-button"
						aria-label={"Close"}
						disabled={busy}
						onClick={() => onOpenChange(false)}
					>
						<X className="size-5" aria-hidden="true" />
					</button>
					<div className={settingsDialogHeaderClass}>
						<Dialog.Title className="settings-dialog-title">{"Session can no longer be restored"}</Dialog.Title>
						<Dialog.Description className="text-control text-settings-muted">
							{orchestrator ? "This orchestrator has no saved agent session to resume. You can create a new orchestrator while AO preserves any workspace data it cannot safely clean." : "This session has no saved agent session or prompt to resume from."}
						</Dialog.Description>
					</div>
					{error ? (
						<div className={settingsDialogBodyClass}>
							<p className="text-xs text-destructive">{error}</p>
						</div>
					) : null}
					<div className={settingsDialogFooterClass}>
						<Button type="button" variant="footer" onClick={() => onOpenChange(false)} disabled={busy}>
							{orchestrator ? "Cancel" : "Close"}
						</Button>
						{orchestrator ? (
							<Button
								type="button"
								variant="footer-primary"
								onClick={recreate}
								disabled={busy || checkingProject}
							>
								{busy ? <Loader2 className="size-icon-base animate-spin" aria-hidden="true" /> : null}
								{checkingProject
									? "Checking project…"
									: hasOrchestratorAgent
										? "Create new orchestrator"
										: "Configure orchestrator agent"}
							</Button>
						) : null}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
