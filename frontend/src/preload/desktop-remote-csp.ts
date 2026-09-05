import { patchRendererCspMeta } from "../shared/desktop-remote-csp";

/** Apply paired remote origins to the renderer CSP meta tag. */
export function applyRemoteCspOrigins(origins: readonly string[]): void {
	if (origins.length === 0) return;
	patchRendererCspMeta(origins);
}
