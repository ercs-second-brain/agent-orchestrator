import { aoBridge } from "./bridge";
import { setApiBaseUrl, setApiDaemonStatus } from "./api-client";
import { remoteConnectOrigins } from "../../shared/desktop-remote";
import { patchRendererCspMeta } from "../../shared/desktop-remote-csp";

export type DaemonStatus = Awaited<ReturnType<typeof aoBridge.daemon.getStatus>>;

export function applyDaemonStatus(nextStatus: DaemonStatus): void {
	setApiDaemonStatus(nextStatus);
	if (nextStatus.connectionMode === "remote" && nextStatus.remoteApiBase) {
		setApiBaseUrl(nextStatus.remoteApiBase);
		try {
			const url = new URL(nextStatus.remoteApiBase);
			const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
			patchRendererCspMeta(
				remoteConnectOrigins({
					host: url.hostname,
					port,
					secure: url.protocol === "https:",
				}),
			);
		} catch {
			// Malformed remote base URLs are rejected earlier during pairing.
		}
		return;
	}
	if (nextStatus.state === "ready" && nextStatus.port) {
		setApiBaseUrl(`http://127.0.0.1:${nextStatus.port}`);
	} else {
		setApiBaseUrl(null);
	}
}

export function isDaemonReady(status: DaemonStatus): boolean {
	if (status.state !== "ready") return false;
	if (status.connectionMode === "remote") return Boolean(status.remoteApiBase);
	return Boolean(status.port);
}

export async function refreshDaemonStatus(): Promise<DaemonStatus> {
	const nextStatus = await readDaemonStatus();
	applyDaemonStatus(nextStatus);
	return nextStatus;
}

export function readDaemonStatus(): Promise<DaemonStatus> {
	return aoBridge.daemon.getStatus();
}
