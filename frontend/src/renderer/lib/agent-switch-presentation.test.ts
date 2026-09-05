import { describe, expect, it } from "vitest";
import type { AgentSwitchSummary } from "../types/workspace";
import {
	agentSwitchVisibilityPresentationKind,
	deriveAgentSwitchPresentation,
	type AgentSwitchPresentation,
	type AgentSwitchPresentationInput,
} from "./agent-switch-presentation";

function switchSummary(
	overrides: Partial<AgentSwitchSummary> = {},
): AgentSwitchSummary {
	return {
		agentHandoffStatus: "not_attempted",
		fromHarness: "claude-code",
		id: "switch-1",
		state: "preparing_handoff",
		targetHarness: "codex",
		...overrides,
	};
}

function input(
	agentSwitch: AgentSwitchSummary,
	overrides: Partial<Omit<AgentSwitchPresentationInput, "agentSwitch">> = {},
): AgentSwitchPresentationInput {
	return {
		agentSwitch,
		activityState: "active",
		currentHarness: "claude-code",
		isTerminated: false,
		terminalHandleId: "source-terminal",
		...overrides,
	};
}

function expectRelationship(
	presentation: AgentSwitchPresentation,
	expected: Pick<
		AgentSwitchPresentation,
		"stage" | "outcome" | "tone" | "animate" | "lockAgentTerminal" | "allowSourceInput"
	>,
) {
	expect(presentation).toMatchObject(expected);
}

describe("deriveAgentSwitchPresentation", () => {
	it.each([
		["preparing_handoff", "preparing", "Preparing handoff"],
		["stopping_source", "stopping_source", "Stopping source agent"],
		["source_stopped", "starting_target", "Source stopped"],
		["starting_target", "starting_target", "Starting target agent"],
		["target_ready", "confirming_takeover", "Target ready"],
		["delivering_context", "confirming_takeover", "Delivering context"],
	] as const)("maps %s into the durable %s stage", (state, stage, description) => {
		const presentation = deriveAgentSwitchPresentation(input(switchSummary({ state })));

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: true,
			lockAgentTerminal: true,
			outcome: "in_progress",
			stage,
			tone: "working",
		});
		expect(presentation).toMatchObject({
			compactLabel: "Switching to Codex",
			description,
			title: "Switching from Claude Code to Codex",
		});
	});

	it.each([
		["blocked", true, "The source agent needs input. Review the terminal prompt to continue the handoff."],
		["waiting_input", true, "The source agent needs input. Review the terminal prompt to continue the handoff."],
		["active", false, "Preparing handoff"],
	] as const)(
		"maps a requested source handoff with %s activity to preparation",
		(activityState, allowSourceInput, description) => {
			const presentation = deriveAgentSwitchPresentation(
				input(switchSummary({ agentHandoffStatus: "requested" }), { activityState }),
			);

			expectRelationship(presentation, {
				allowSourceInput,
				animate: true,
				lockAgentTerminal: !allowSourceInput,
				outcome: "in_progress",
				stage: "preparing",
				tone: allowSourceInput ? "warning" : "working",
			});
			expect(presentation.description).toBe(description);
		},
	);

	it("treats target-start uncertainty as static recovery before the ordinary starting stage", () => {
		const presentation = deriveAgentSwitchPresentation(
			input(switchSummary({ errorCode: "target_start_unconfirmed", state: "starting_target" })),
		);

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: false,
			lockAgentTerminal: true,
			outcome: "recovery",
			stage: "needs_attention",
			tone: "warning",
		});
		expect(presentation).toMatchObject({
			compactLabel: "Agent switch needs recovery",
			description: "AO could not confirm whether the target agent started. Terminal input remains locked to prevent two agents from owning the session.",
			title: "Target startup could not be confirmed",
		});
	});

	it("treats a failed source restoration as a provider-specific recovery action", () => {
		const presentation = deriveAgentSwitchPresentation(
			input(switchSummary({ errorCode: "source_restore_unconfirmed", state: "source_stopped" })),
		);

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: false,
			lockAgentTerminal: true,
			outcome: "recovery",
			stage: "needs_attention",
			tone: "warning",
		});
		expect(presentation).toMatchObject({
			compactLabel: "Claude Code needs restoration",
			description: "The switch failed, and AO could not restore Claude Code. Terminal input remains locked until AO verifies one active owner.",
			title: "Claude Code could not be restored",
		});
	});

	it("treats an unconfirmed source stop as actionable recovery", () => {
		const presentation = deriveAgentSwitchPresentation(
			input(switchSummary({ errorCode: "source_stop_unconfirmed", state: "stopping_source" })),
		);

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: false,
			lockAgentTerminal: true,
			outcome: "recovery",
			stage: "needs_attention",
			tone: "warning",
		});
		expect(presentation).toMatchObject({
			compactLabel: "Agent switch needs recovery",
			description: "AO could not confirm whether Claude Code stopped. Check the session before continuing.",
			title: "Claude Code status could not be confirmed",
		});
	});

	it("keeps a completed row in confirmation until the target harness and terminal settle", () => {
		const presentation = deriveAgentSwitchPresentation(input(switchSummary({ state: "completed" })));

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: true,
			lockAgentTerminal: true,
			outcome: "in_progress",
			stage: "confirming_takeover",
			tone: "working",
		});
		expect(presentation.description).toBe("Completed");
	});

	it.each([
		[
			"the target terminal is missing",
			{ currentHarness: "codex", terminalHandleId: undefined, isTerminated: false },
		],
		[
			"the projected session is terminated",
			{ currentHarness: "codex", terminalHandleId: "target-terminal", isTerminated: true },
		],
		[
			"the source harness is still projected",
			{ currentHarness: "claude-code", terminalHandleId: "target-terminal", isTerminated: false },
		],
	] as const)("does not settle completion when %s", (_name, settlement) => {
		const presentation = deriveAgentSwitchPresentation(
			input(switchSummary({ state: "completed" }), settlement),
		);

		expect(presentation).toMatchObject({
			lockAgentTerminal: true,
			outcome: "in_progress",
			stage: "confirming_takeover",
		});
	});

	it("settles completion only after the live target harness and terminal are projected", () => {
		const presentation = deriveAgentSwitchPresentation(
			input(switchSummary({ state: "completed" }), {
				currentHarness: "codex",
				isTerminated: false,
				terminalHandleId: "target-terminal",
			}),
		);

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: false,
			lockAgentTerminal: false,
			outcome: "success",
			stage: null,
			tone: "success",
		});
		expect(presentation).toMatchObject({
			compactLabel: "Switched to Codex",
			description: "Completed",
			title: "Switched to Codex",
		});
	});

	it.each([
		["target_binary_missing", "Target agent is not installed"],
		["future_failure", "Failed"],
	] as const)("maps failed switches through the stable %s error detail", (errorCode, description) => {
		const presentation = deriveAgentSwitchPresentation(
			input(switchSummary({ errorCode, state: "failed" })),
		);

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: false,
			lockAgentTerminal: false,
			outcome: "failure",
			stage: "needs_attention",
			tone: "danger",
		});
		expect(presentation).toMatchObject({
			compactLabel: "Agent switch failed",
			description,
			title: "Failed",
		});
	});

	it("protects terminal ownership while checking a future durable state", () => {
		const presentation = deriveAgentSwitchPresentation(
			input(switchSummary({ state: "future_phase" })),
		);

		expectRelationship(presentation, {
			allowSourceInput: false,
			animate: true,
			lockAgentTerminal: true,
			outcome: "in_progress",
			stage: "preparing",
			tone: "working",
		});
		expect(presentation).toMatchObject({
			compactLabel: "Checking switch status",
			description: "Checking switch status…",
			title: "Checking switch status…",
		});
	});
});

describe("agent switch visibility presentation classification", () => {
	it("classifies only required failure and recovery UI", () => {
		expect(agentSwitchVisibilityPresentationKind({ outcome: "failure" } as AgentSwitchPresentation)).toBe("terminal_failure");
		expect(agentSwitchVisibilityPresentationKind({ outcome: "recovery" } as AgentSwitchPresentation)).toBe("recovery_required");
		expect(agentSwitchVisibilityPresentationKind({ outcome: "in_progress" } as AgentSwitchPresentation)).toBeUndefined();
		expect(agentSwitchVisibilityPresentationKind({ outcome: "success" } as AgentSwitchPresentation)).toBeUndefined();
	});
});
