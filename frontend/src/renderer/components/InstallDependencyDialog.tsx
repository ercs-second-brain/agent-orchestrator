import { Check, Copy, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "../../api/schema";
import { apiClient, apiErrorMessage } from "../lib/api-client";
import { aoBridge } from "../lib/bridge";
import { cn } from "../lib/utils";
import { requirementDetailText, requirementDisplayLabel, type SystemRequirement } from "./SystemRequirementsChecklist";
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

type InstallJob = components["schemas"]["InstallJob"];
type SystemInstallTarget = "tmux" | "gh" | "claude" | "cloudflared";
type AgentInstallTarget = "pi";

const POLL_INTERVAL_MS = 1_000;

export function isActiveInstallJob(job: InstallJob | undefined): boolean {
	return job?.status === "running" || job?.status === "installing" || job?.status === "verifying";
}

/** Sequential single-target install job runner: POST to start, GET on an
 *  interval while running. One target is ever in flight at a time — this
 *  gate only ever needs one, and serializing keeps the UI unambiguous about
 *  which command is running. */
function useInstallRunner(onSucceeded: () => void) {
	const [target, setTarget] = useState<SystemInstallTarget | null>(null);
	const [job, setJob] = useState<InstallJob | undefined>(undefined);
	const [previews, setPreviews] = useState<Partial<Record<SystemInstallTarget, InstallJob>>>({});
	const [inspectedTargets, setInspectedTargets] = useState<Partial<Record<SystemInstallTarget, boolean>>>({});
	const [isStarting, setIsStarting] = useState(false);
	const [startError, setStartError] = useState<string | undefined>(undefined);
	const pollRef = useRef<number | null>(null);
	const inspectedRef = useRef(new Set<SystemInstallTarget>());
	const onSucceededRef = useRef(onSucceeded);
	onSucceededRef.current = onSucceeded;

	const stopPolling = () => {
		if (pollRef.current !== null) {
			window.clearInterval(pollRef.current);
			pollRef.current = null;
		}
	};
	useEffect(() => stopPolling, []);

	const poll = (polledTarget: SystemInstallTarget) => {
		stopPolling();
		pollRef.current = window.setInterval(() => {
			void (async () => {
				const { data, error } = await apiClient.GET("/api/v1/system/install/{target}", {
					params: { path: { target: polledTarget } },
				});
				if (error || !data) return; // transient — try again next tick
				setJob(data);
				if (isActiveInstallJob(data)) return;
				stopPolling();
				if (data.status === "succeeded") onSucceededRef.current();
			})();
		}, POLL_INTERVAL_MS);
	};

	// GET doubles as a safe install-plan preview. In particular, Linux returns
	// Unsupported plus the exact sudo command, so the renderer can show manual
	// instructions without first POSTing a job that is guaranteed to fail.
	const inspect = useCallback(async (nextTarget: SystemInstallTarget) => {
		if (inspectedRef.current.has(nextTarget)) return;
		inspectedRef.current.add(nextTarget);
		try {
			const { data, error } = await apiClient.GET("/api/v1/system/install/{target}", {
				params: { path: { target: nextTarget } },
			});
			if (error || !data) return;
			setPreviews((current) => ({ ...current, [nextTarget]: data }));
		} catch {
			// The requirements gate remains usable if plan inspection fails. The
			// POST action will still surface its own concrete error when selected.
		} finally {
			setInspectedTargets((current) => ({ ...current, [nextTarget]: true }));
		}
	}, []);

	const start = async (nextTarget: SystemInstallTarget) => {
		stopPolling();
		setTarget(nextTarget);
		setJob(undefined);
		setStartError(undefined);
		setIsStarting(true);
		try {
			const { data, error } = await apiClient.POST("/api/v1/system/install/{target}", {
				params: { path: { target: nextTarget } },
			});
			if (error || !data) throw new Error(apiErrorMessage(error, "Could not start the install."));
			setJob(data);
			if (isActiveInstallJob(data)) poll(nextTarget);
			else if (data.status === "succeeded") onSucceededRef.current();
		} catch (err) {
			setStartError(err instanceof Error ? err.message : "Could not start the install.");
		} finally {
			setIsStarting(false);
		}
	};

	const running = isStarting || isActiveInstallJob(job);
	const jobFor = (nextTarget: SystemInstallTarget) => (target === nextTarget ? job : previews[nextTarget]);
	const inspectionFinished = (nextTarget: SystemInstallTarget) => inspectedTargets[nextTarget] === true;
	return { target, startError, running, start, inspect, jobFor, inspectionFinished };
}

export function InstallDependencyDialog({
	requirements,
	onRefetchRequirements,
}: {
	requirements: SystemRequirement[];
	onRefetchRequirements: () => Promise<unknown> | void;
}) {
	const [ghDismissed, setGhDismissed] = useState(false);
	const [isCheckingAgain, setIsCheckingAgain] = useState(false);
	const install = useInstallRunner(() => void onRefetchRequirements());
	const [agentJob, setAgentJob] = useState<InstallJob | undefined>(undefined);
	const [agentPreview, setAgentPreview] = useState<InstallJob | undefined>(undefined);
	const [agentError, setAgentError] = useState<string | undefined>(undefined);
	const [agentStarting, setAgentStarting] = useState(false);
	const [agentInspected, setAgentInspected] = useState(false);
	const agentPollRef = useRef<number | null>(null);
	const inspectedAgentsRef = useRef(new Set<AgentInstallTarget>());

	useEffect(() => () => {
		if (agentPollRef.current !== null) window.clearInterval(agentPollRef.current);
	}, []);

	const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
	const git = byId.get("git");
	const tmux = byId.get("tmux");
	const harness = byId.get("harness");
	const gh = byId.get("gh");
	const gitBlocking = Boolean(git && git.required && !git.satisfied);
	const tmuxBlocking = Boolean(tmux && tmux.required && !tmux.satisfied);
	const harnessBlocking = Boolean(harness && harness.required && !harness.satisfied);
	const ghAdvisory = Boolean(gh && !gh.satisfied);

	useEffect(() => {
		if (tmuxBlocking) void install.inspect("tmux");
	}, [install.inspect, tmuxBlocking]);

	useEffect(() => {
		if (ghAdvisory) void install.inspect("gh");
	}, [ghAdvisory, install.inspect]);

	const inspectAgent = useCallback(async (agent: AgentInstallTarget) => {
		if (inspectedAgentsRef.current.has(agent)) return;
		inspectedAgentsRef.current.add(agent);
		try {
			const { data, error } = await apiClient.GET("/api/v1/agents/{agent}/install", {
				params: { path: { agent } },
			});
			if (error || !data) return;
			setAgentPreview(data);
		} catch {
			// The requirements gate remains usable if plan inspection fails.
		} finally {
			setAgentInspected(true);
		}
	}, []);

	const startAgent = async (agent: AgentInstallTarget) => {
		setAgentJob(undefined);
		setAgentError(undefined);
		setAgentStarting(true);
		try {
			const { data, error } = await apiClient.POST("/api/v1/agents/{agent}/install", {
				params: { path: { agent } },
				body: {},
			});
			if (error || !data) throw new Error(apiErrorMessage(error, "Could not start the install."));
			setAgentJob(data);
			if (isActiveInstallJob(data)) {
				agentPollRef.current = window.setInterval(() => {
					void (async () => {
						const { data: next, error: nextError } = await apiClient.GET("/api/v1/agents/{agent}/install", {
							params: { path: { agent } },
						});
						if (nextError || !next) return;
						setAgentJob(next);
						if (isActiveInstallJob(next)) return;
						window.clearInterval(agentPollRef.current!);
						agentPollRef.current = null;
						if (next.status === "succeeded") void onRefetchRequirements();
					})();
				}, POLL_INTERVAL_MS);
			} else if (data.status === "succeeded") void onRefetchRequirements();
		} catch (err) {
			setAgentError(err instanceof Error ? err.message : "Could not start the install.");
		} finally {
			setAgentStarting(false);
		}
	};

	useEffect(() => {
		if (harnessBlocking) void inspectAgent("pi");
	}, [harnessBlocking]);

	const checkAgain = async () => {
		setIsCheckingAgain(true);
		try {
			await onRefetchRequirements();
		} finally {
			setIsCheckingAgain(false);
		}
	};

	const title = harnessBlocking ? "No coding agent found" : "Missing dependency";

	return (
		<Dialog open onOpenChange={() => {}}>
			<DialogContent
				showCloseButton={false}
				className={settingsDialogContentClass}
				onEscapeKeyDown={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
			>
				<div className={settingsDialogHeaderClass}>
					<DialogTitle className="settings-dialog-title">{title}</DialogTitle>
					<DialogDescription asChild>
						<div className="text-control leading-4 text-settings-muted">{"Agent Orchestrator needs a few things on this machine before it can run sessions. Install what's missing below, or quit and finish setup yourself."}</div>
					</DialogDescription>
				</div>

				<div className={cn(settingsDialogBodyClass, "gap-5")}>
					{gitBlocking && git ? (
						<IssueSection label={requirementDisplayLabel(git)} detail={requirementDetailText(git)}>
							<p className="text-caption leading-snug text-settings-muted">{"Install git from git-scm.com, then restart Agent Orchestrator."}</p>
						</IssueSection>
					) : null}

					{tmuxBlocking && tmux ? (
						<IssueSection label={requirementDisplayLabel(tmux)} detail={requirementDetailText(tmux)}>
							<InstallAction
								primaryLabel={"Install tmux"}
								disabled={install.running && install.target !== "tmux"}
								job={install.jobFor("tmux")}
								planChecked={install.inspectionFinished("tmux")}
								error={install.target === "tmux" ? install.startError : undefined}
								onInstall={() => void install.start("tmux")}
							/>
						</IssueSection>
					) : null}

					{harnessBlocking && harness ? (
						<IssueSection label={requirementDisplayLabel(harness)} detail={requirementDetailText(harness)}>
							<InstallAction
								primaryLabel={"Install pi"}
								disabled={agentStarting || (isActiveInstallJob(agentJob) && agentJob?.target !== "pi")}
								job={agentJob ?? agentPreview}
								planChecked={agentInspected}
								error={agentError}
								onInstall={() => void startAgent("pi")}
							/>
						</IssueSection>
					) : null}

					{ghAdvisory && gh && !ghDismissed ? (
						<div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs leading-body-md">
							<p className="font-medium text-settings-title">{"Recommended: install gh"}</p>
							<p className="mt-0.5 text-settings-muted">{requirementDetailText(gh)}</p>
							<div className="mt-2">
								<InstallAction
									primaryLabel={"Install gh"}
									disabled={install.running && install.target !== "gh"}
									job={install.jobFor("gh")}
									planChecked={install.inspectionFinished("gh")}
									error={install.target === "gh" ? install.startError : undefined}
									onInstall={() => void install.start("gh")}
								/>
							</div>
							<button
								type="button"
								className="mt-2 text-caption text-settings-muted underline-offset-2 hover:underline"
								onClick={() => setGhDismissed(true)}
							>
								{"Don't show this again this session"}
							</button>
						</div>
					) : null}
				</div>

				<div className={settingsDialogFooterClass}>
					<button
						type="button"
						className="settings-footer-button"
						onClick={() => void window.ao?.menu?.action("app.quit")}
					>
						{"Quit"}
					</button>
					<button
						type="button"
						className="settings-footer-button settings-footer-button-primary"
						disabled={isCheckingAgain || install.running}
						onClick={() => void checkAgain()}
					>
						{isCheckingAgain ? "Checking…" : "Check again"}
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function IssueSection({
	label,
	detail,
	children,
}: {
	label: string;
	detail?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-start gap-2">
				<XCircle className="mt-0.5 size-icon-sm shrink-0 text-destructive" aria-hidden="true" />
				<div className="min-w-0">
					<p className="text-control font-medium text-settings-title">{label}</p>
					{detail ? <p className="text-caption text-settings-muted">{detail}</p> : null}
				</div>
			</div>
			{children ? <div className="pl-[calc(var(--size-icon-sm)+0.625rem)]">{children}</div> : null}
		</div>
	);
}

function InstallAction({
	primaryLabel,
	disabled,
	job,
	planChecked,
	error,
	onInstall,
}: {
	primaryLabel: string;
	disabled: boolean;
	job: InstallJob | undefined;
	planChecked: boolean;
	error: string | undefined;
	onInstall: () => void;
}) {
	const running = isActiveInstallJob(job);
	const failed = job?.status === "failed";
	const unsupported = job?.status === "unsupported";

	if (!planChecked) {
		return <p className="text-caption text-settings-muted">{"Checking install options…"}</p>;
	}

	if (running) {
		return (
			<div className="flex flex-col gap-1.5">
				<p className="text-caption text-settings-muted">
					{job?.command ? `Installing — ${job.command}` : "Installing…"}
				</p>
				<div className="ao-install-progress" aria-hidden="true">
					<div className="ao-install-progress__bar" />
				</div>
			</div>
		);
	}

	if (unsupported) {
		return (
			<div className="flex flex-col gap-1.5">
				{job.error ? <p className="text-caption text-settings-muted">{job.error}</p> : null}
				{job.command ? <ManualCommand command={job.command} /> : null}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			<button
				type="button"
				className="settings-footer-button settings-footer-button-primary self-start"
				disabled={disabled}
				onClick={onInstall}
			>
				{failed ? `Retry: ${primaryLabel}` : primaryLabel}
			</button>
			{error ? <p className="text-caption text-error">{error}</p> : null}
			{failed ? (
				<>
					{job?.error ? <p className="text-caption text-error">{job.error}</p> : null}
					{job?.output ? (
						<pre className="max-h-daemon-failure-details-max overflow-auto rounded-md border border-[var(--color-border-settings-dialog)] bg-[var(--color-bg-settings-input)] px-2 py-1.5 font-mono text-caption leading-relaxed text-settings-muted">
							{job.output}
						</pre>
					) : null}
				</>
			) : null}
		</div>
	);
}

function ManualCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(resetTimer.current), []);

	const copy = () => {
		void aoBridge.clipboard.writeText(command).then(
			() => {
				setCopied(true);
				clearTimeout(resetTimer.current);
				resetTimer.current = setTimeout(() => setCopied(false), 1_400);
			},
			() => undefined,
		);
	};

	return (
		<div className="flex items-center gap-2 rounded-md border border-[var(--color-border-settings-dialog)] bg-[var(--color-bg-settings-input)] px-2 py-1.5">
			<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-caption text-settings-title">
				{command}
			</code>
			<button
				type="button"
				className="settings-footer-button shrink-0"
				aria-label={copied ? "Copied" : "Copy command"}
				onClick={copy}
			>
				{copied ? <Check className="size-icon-sm" aria-hidden="true" /> : <Copy className="size-icon-sm" aria-hidden="true" />}
				{copied ? "Copied" : "Copy command"}
			</button>
		</div>
	);
}
