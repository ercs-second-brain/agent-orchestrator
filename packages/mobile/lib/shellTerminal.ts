import { apiRequest } from "./api";
import type { ServerConfig } from "./config";

/** Close a worktree shell terminal by its daemon handle. */
export async function closeShellTerminal(cfg: ServerConfig, handleId: string): Promise<void> {
	await apiRequest(cfg, `/api/v1/shell-terminals/${encodeURIComponent(handleId)}`, { method: "DELETE" });
}
