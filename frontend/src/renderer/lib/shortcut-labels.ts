import type { AppShortcutId, ShortcutCategory } from "../../shared/shortcuts";

export const shortcutLabels: Record<AppShortcutId, string> = {
	"new-session": "New session",
	"new-shell-terminal": "New shell terminal",
	"close-shell-terminal": "Close terminal",
	"keyboard-shortcuts": "Keyboard shortcuts",
	"command-palette": "Command palette",
	"open-settings": "Open settings",
	"toggle-sidebar": "Toggle sidebar",
	"open-project": "Open project",
	"previous-session": "Previous session",
	"next-session": "Next session",
	"previous-tab": "Previous tab",
	"next-tab": "Next tab",
	"toggle-inspector": "Toggle inspector",
	"focus-terminal": "Focus terminal",
	"toggle-browser-devtools": "Toggle DevTools",
};

export const shortcutCategoryLabels: Record<ShortcutCategory, string> = {
	General: "General",
	Navigation: "Navigation",
	Session: "Session",
};
