import { aoBridge } from "../lib/bridge";
import { parseNightlyVersion } from "../lib/build-channel";
import { useUpdateStatus } from "../hooks/useUpdateStatus";
import { useUiStore } from "../stores/ui-store";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	settingsDialogBodyClass,
	settingsDialogContentClass,
	settingsDialogFooterClass,
	settingsDialogHeaderClass,
} from "./ui/dialog";

/**
 * Confirmation for restarting into a staged build.
 *
 * The sidebar row and the Settings button used to call updates.install()
 * straight through, so a single click quit the app. Chat sessions — the ones
 * that could lose an in-flight turn — are gone with the chat concept itself
 * (ADR 0005 / #39): every session now runs in a terminal runtime that survives
 * the quit and is re-adopted on next boot. What remains is the plain "show me
 * what this build changes before I quit" confirmation.
 */
export function RestartToUpdateDialog() {
	const open = useUiStore((state) => state.updateInstallPromptOpen);
	// Gate before any other hook runs. This is mounted for the whole shell's
	// lifetime but visible almost never, and the body below subscribes to the
	// update-status channel and reads the workspace list — neither is worth
	// paying for on every shell mount, and both would couple every shell test
	// to bridge mocks it has no reason to provide.
	if (!open) return null;
	return <RestartToUpdateDialogBody />;
}

function RestartToUpdateDialogBody() {
	const close = useUiStore((state) => state.closeUpdateInstallPrompt);
	const status = useUpdateStatus();

	const staged = status.staged;
	const version = staged?.version ?? status.version;
	const nightly = parseNightlyVersion(version);
	const buildLabel = nightly
		? `Nightly ${nightly.base} · ${new Intl.DateTimeFormat("en", {
					month: "short",
					day: "numeric",
				}).format(nightly.builtAt)}`
		: version
			? `v${version}`
			: null;

	const confirm = () => {
		close();
		void aoBridge.updates.install();
	};

	return (
		<Dialog open onOpenChange={(next) => !next && close()}>
			<DialogContent className={settingsDialogContentClass} data-testid="restart-to-update-dialog">
				<div className={settingsDialogHeaderClass}>
					<DialogTitle>{"Restart to update"}</DialogTitle>
					{buildLabel && <DialogDescription>{buildLabel}</DialogDescription>}
				</div>

				<div className={settingsDialogBodyClass}>
					<p className="text-caption font-medium uppercase tracking-wide text-settings-muted">
						{"What's new"}
					</p>
					{status.releaseNotes ? (
						// Plain text on purpose. The notes are the remote release body,
						// sanitized in the main process; nothing here injects markup.
						<p className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-line text-pretty text-sm leading-5 text-settings-label">
							{status.releaseNotes}
						</p>
					) : (
						<p className="mt-1.5 text-sm leading-5 text-settings-muted">{"No release notes were published for this build."}</p>
					)}

					<p className="mt-4 text-xs leading-4 text-settings-muted">{"This build also installs on its own the next time you quit the app."}</p>
				</div>

				<div className={settingsDialogFooterClass}>
					<Button type="button" variant="outline" size="sm" onClick={close}>
						{"Cancel"}
					</Button>
					<Button type="button" variant="primary" size="sm" onClick={confirm}>
						{"Restart & install"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
