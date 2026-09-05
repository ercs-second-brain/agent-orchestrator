import { useDaemonStatus } from "./useDaemonStatus";

/** True when the desktop is attached to a LAN daemon instead of a local one. */
export function useRemoteConnection(): boolean {
	const status = useDaemonStatus();
	return status.connectionMode === "remote" && status.state === "ready";
}
