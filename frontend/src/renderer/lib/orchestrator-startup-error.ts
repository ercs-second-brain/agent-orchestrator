const DEFAULT_BRANCH_UNRESOLVED_CODE = "DEFAULT_BRANCH_UNRESOLVED";

function extractRemoteUrl(message: string): string | null {
	const singleQuoted = message.match(/fatal:\s+repository\s+'([^']+)'/i);
	if (singleQuoted?.[1]) return singleQuoted[1].replace(/\/+$/, "");
	const doubleQuoted = message.match(/repository\s+"([^"]+\.git)"\s+not found/i);
	if (doubleQuoted?.[1]) return doubleQuoted[1].replace(/\/+$/, "");
	return null;
}

function extractWorkspaceRepoName(message: string): string | null {
	const namedRepo = message.match(/resolve workspace repo\s+"([^"]+)"/i);
	if (namedRepo?.[1]) return namedRepo[1];
	return null;
}

function isPiHostPathError(message: string): boolean {
	if (message.includes("AGENT_BINARY_NOT_FOUND") || /agent:\s*binary not found on PATH/i.test(message)) {
		return true;
	}
	if (/probe pi --version/i.test(message)) return true;
	return /exit status 127/.test(message) && /\bpi\b/i.test(message);
}

export function formatOrchestratorStartupError(message: string): string {
	if (!message) return message;
	if (isPiHostPathError(message)) {
		return "The AO host cannot run Pi. An SSH shell may have `pi` on PATH, but the daemon does not inherit that PATH — Node must also be visible so the Pi shim can start. Add the directories for `pi` and `node` to the ao-daemon systemd unit PATH and restart the service.";
	}
	if (!message.includes(DEFAULT_BRANCH_UNRESOLVED_CODE)) return message;
	const repoName = extractWorkspaceRepoName(message);
	const remoteUrl = extractRemoteUrl(message);
	const repoLabel = repoName ? `child repository "${repoName}"` : "child repository";
	if (remoteUrl) {
		return `Project added, but orchestrator did not start. The ${repoLabel} still needs its remote repository set up at ${remoteUrl}. Create or fix that remote, then retry starting the orchestrator.`;
	}
	return `Project added, but orchestrator did not start. The ${repoLabel} still needs its remote repository set up before the orchestrator can start. Create or fix that remote, then retry starting the orchestrator.`;
}
