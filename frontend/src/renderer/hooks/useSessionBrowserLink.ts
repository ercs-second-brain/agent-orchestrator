import { useCallback } from "react";
import { openLinkInSystemBrowser } from "../lib/external-link-policy";

/**
 * Handle a link opened from a terminal surface.
 *
 * The daemon-side browser preview route was removed with the chat/browser
 * backend layer (#39), so links now open in the system browser.
 */
export function useSessionBrowserLink(): (uri: string) => void {
	return useCallback((uri: string) => {
		try {
			const url = new URL(uri);
			if (url.protocol !== "http:" && url.protocol !== "https:") return;
			void openLinkInSystemBrowser(url.href);
		} catch {
			return;
		}
	}, []);
}
