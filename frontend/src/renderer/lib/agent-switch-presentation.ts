import type { components } from "../../api/schema";
import type { AgentSwitchSummary, WorkspaceSession } from "../types/workspace";
import { agentLabel } from "./agent-options";

export type AgentSwitchErrorCode = NonNullable<components["schemas"]["AgentSwitch"]["errorCode"]>;

/** English labels for known switch error codes; newer daemons fall back to a generic label. */
const agentSwitchErrorLabels: Record<AgentSwitchErrorCode, string> = {
	daemon_restart_pre_stop: "Recovery failed before source shutdown",
	daemon_restart_post_stop: "Recovery failed after source shutdown",
	daemon_restart_unrecoverable_target: "Target agent could not be recovered",
	daemon_restart_before_delivery: "Recovery failed before context delivery",
	delivery_unconfirmed: "Delivery unconfirmed",
	source_session_terminated: "Source session was terminated",
	source_stop_unconfirmed: "Source shutdown unconfirmed",
	target_binary_missing: "Target agent is not installed",
	target_agent_unauthorized: "Target agent is not authenticated",
	request_cancelled: "Switch request was interrupted",
	source_blocked: "Source agent needs attention",
	failed_pre_stop: "Switch failed before source shutdown",
	failed_post_stop: "Switch failed after source shutdown",
	target_ready_failed: "Target agent did not become ready",
	delivery_failed: "Context delivery failed",
	switch_failed: "Switch failed",
	target_start_unconfirmed: "Target startup unconfirmed",
	source_restore_unconfirmed: "The switch failed, and AO could not restore {{source}}. Terminal input remains locked until AO verifies one active owner.",
};

export type AgentSwitchPresentation = {
	stage:
		| "preparing"
		| "stopping_source"
		| "starting_target"
		| "confirming_takeover"
		| "needs_attention"
		| null;
	outcome: "in_progress" | "success" | "failure" | "recovery";
	compactLabel: string;
	title: string;
	description: string;
	tone: "working" | "success" | "warning" | "danger";
	animate: boolean;
	lockAgentTerminal: boolean;
	allowSourceInput: boolean;
};

export type AgentSwitchPresentationInput = {
	agentSwitch: AgentSwitchSummary;
	currentHarness: string;
	activityState?: string;
	terminalHandleId?: string;
	isTerminated: boolean;
};

export function agentSwitchVisibilityPresentationKind(
	presentation: Pick<AgentSwitchPresentation, "outcome"> | undefined,
): "terminal_failure" | "recovery_required" | undefined {
	if (presentation?.outcome === "failure") return "terminal_failure";
	if (presentation?.outcome === "recovery") return "recovery_required";
	return undefined;
}

export type AgentSwitchStatusVisual = {
	className: string;
	indicatorClassName: string;
	tone: string;
	breathe: boolean;
};

const inProgressDescriptions: Partial<Record<string, string>> = {
	preparing_handoff: "Preparing handoff",
	stopping_source: "Stopping source agent",
	source_stopped: "Source stopped",
	starting_target: "Starting target agent",
	target_ready: "Target ready",
	delivering_context: "Delivering context",
};

function failureDescription(errorCode?: string): string {
	if (!errorCode) return "Failed";
	return agentSwitchErrorLabels[errorCode as AgentSwitchErrorCode] ?? "Failed";
}

export function deriveAgentSwitchPresentation({
	agentSwitch,
	currentHarness,
	activityState,
	terminalHandleId,
	isTerminated,
}: AgentSwitchPresentationInput): AgentSwitchPresentation {
	const values = {
		source: agentLabel(agentSwitch.fromHarness),
		target: agentLabel(agentSwitch.targetHarness),
	};

	if (agentSwitch.state === "stopping_source" && agentSwitch.errorCode === "source_stop_unconfirmed") {
		return {
			stage: "needs_attention",
			outcome: "recovery",
			compactLabel: "Agent switch needs recovery",
			title: `${values.source} status could not be confirmed`,
			description: `AO could not confirm whether ${values.source} stopped. Check the session before continuing.`,
			tone: "warning",
			animate: false,
			lockAgentTerminal: true,
			allowSourceInput: false,
		};
	}

	if (
		(agentSwitch.state === "source_stopped" || agentSwitch.state === "starting_target") &&
		agentSwitch.errorCode === "source_restore_unconfirmed"
	) {
		return {
			stage: "needs_attention",
			outcome: "recovery",
			compactLabel: `${values.source} needs restoration`,
			title: `${values.source} could not be restored`,
			description: `The switch failed, and AO could not restore ${values.source}. Terminal input remains locked until AO verifies one active owner.`,
			tone: "warning",
			animate: false,
			lockAgentTerminal: true,
			allowSourceInput: false,
		};
	}

	if (agentSwitch.state === "starting_target" && agentSwitch.errorCode === "target_start_unconfirmed") {
		return {
			stage: "needs_attention",
			outcome: "recovery",
			compactLabel: "Agent switch needs recovery",
			title: "Target startup could not be confirmed",
			description: "AO could not confirm whether the target agent started. Terminal input remains locked to prevent two agents from owning the session.",
			tone: "warning",
			animate: false,
			lockAgentTerminal: true,
			allowSourceInput: false,
		};
	}

	if (agentSwitch.state === "failed") {
		return {
			stage: "needs_attention",
			outcome: "failure",
			compactLabel: "Agent switch failed",
			title: "Failed",
			description: failureDescription(agentSwitch.errorCode),
			tone: "danger",
			animate: false,
			lockAgentTerminal: false,
			allowSourceInput: false,
		};
	}

	if (agentSwitch.state === "completed") {
		const settled =
			currentHarness === agentSwitch.targetHarness &&
			Boolean(terminalHandleId?.trim()) &&
			!isTerminated;
		return {
			stage: settled ? null : "confirming_takeover",
			outcome: settled ? "success" : "in_progress",
			compactLabel: settled ? `Switched to ${values.target}` : `Switching to ${values.target}`,
			title: settled ? `Switched to ${values.target}` : `Switching from ${values.source} to ${values.target}`,
			description: "Completed",
			tone: settled ? "success" : "working",
			animate: !settled,
			lockAgentTerminal: !settled,
			allowSourceInput: false,
		};
	}

	if (agentSwitch.state === "preparing_handoff" && agentSwitch.agentHandoffStatus === "requested") {
		const allowSourceInput = activityState === "blocked" || activityState === "waiting_input";
		return {
			stage: "preparing",
			outcome: "in_progress",
			compactLabel: allowSourceInput ? "Source agent needs input" : `Switching to ${values.target}`,
			title: `Switching from ${values.source} to ${values.target}`,
			description: allowSourceInput
				? "The source agent needs input. Review the terminal prompt to continue the handoff."
				: "Preparing handoff",
			tone: allowSourceInput ? "warning" : "working",
			animate: true,
			lockAgentTerminal: !allowSourceInput,
			allowSourceInput,
		};
	}

	let stage: AgentSwitchPresentation["stage"] | undefined;
	switch (agentSwitch.state) {
		case "preparing_handoff":
			stage = "preparing";
			break;
		case "stopping_source":
			stage = "stopping_source";
			break;
		case "source_stopped":
		case "starting_target":
			stage = "starting_target";
			break;
		case "target_ready":
		case "delivering_context":
			stage = "confirming_takeover";
			break;
	}

	if (stage) {
		return {
			stage,
			outcome: "in_progress",
			compactLabel: `Switching to ${values.target}`,
			title: `Switching from ${values.source} to ${values.target}`,
			description: inProgressDescriptions[agentSwitch.state] ?? "Checking switch status…",
			tone: "working",
			animate: true,
			lockAgentTerminal: true,
			allowSourceInput: false,
		};
	}

	return {
		stage: "preparing",
		outcome: "in_progress",
		compactLabel: "Checking switch status",
		title: "Checking switch status…",
		description: "Checking switch status…",
		tone: "working",
		animate: true,
		lockAgentTerminal: true,
		allowSourceInput: false,
	};
}

export function deriveSessionAgentSwitchPresentation(
	session: WorkspaceSession,
): AgentSwitchPresentation | undefined {
	if (!session.activeAgentSwitch) return undefined;
	return deriveAgentSwitchPresentation({
		agentSwitch: session.activeAgentSwitch,
		activityState: session.activity?.state,
		currentHarness: session.provider,
		isTerminated: Boolean(session.isTerminated),
		terminalHandleId: session.terminalHandleId,
	});
}

export function agentSwitchStatusVisual(presentation: AgentSwitchPresentation): AgentSwitchStatusVisual {
	switch (presentation.tone) {
		case "success":
			return {
				className: "text-status-ready",
				indicatorClassName: "bg-status-ready",
				tone: "var(--color-status-ready)",
				breathe: false,
			};
		case "warning":
			return {
				className: "text-status-needs-you",
				indicatorClassName: "bg-status-needs-you",
				tone: "var(--color-status-needs-you)",
				breathe: false,
			};
		case "danger":
			return {
				className: "text-status-exited",
				indicatorClassName: "bg-status-exited",
				tone: "var(--color-status-exited)",
				breathe: false,
			};
		default:
			return {
				className: "text-status-working",
				indicatorClassName: "bg-status-working",
				tone: "var(--color-status-working)",
				breathe: presentation.animate,
			};
	}
}
