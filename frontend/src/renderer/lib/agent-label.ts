// Single supported harness (ADR 0005): pi is the only agent label AO renders.
const agentLabels: Record<string, string> = {
	pi: "pi",
};

export function agentLabel(provider: string): string {
	return agentLabels[provider] ?? provider;
}
