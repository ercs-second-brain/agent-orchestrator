// ADR 0005: pi is the single supported harness. The former 27-entry agent
// catalog collapses to one entry; labels stay available for legacy callers.
export const AGENT_OPTIONS = ["pi"] as const;
export type AgentId = (typeof AGENT_OPTIONS)[number];
export type AgentOption = AgentId;

export const AGENT_LABELS: Record<string, string> = {
	pi: "pi",
};

export function agentLabel(id: string): string {
	return AGENT_LABELS[id] ?? id;
}

export type AgentCapability = string;
export type AgentAvailability = { available: boolean; reason?: string };
export type AgentIdentity = { id: string; label: string; logoKey?: string; initial: string };
export type AgentOption2 = never;
export type AgentProfile = {
	id: AgentId;
	label: string;
	capabilities?: readonly AgentCapability[];
	availability?: AgentAvailability;
	logoKey?: string;
};
export function hasAgentCapability(_profile: AgentProfile | undefined, _capability: AgentCapability): boolean {
	return false;
}
