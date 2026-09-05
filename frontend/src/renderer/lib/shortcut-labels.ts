import type { AppShortcutId, ShortcutCategory } from "../../shared/shortcuts";

export const shortcutLabels: Record<AppShortcutId, string> = {
	"new-session": "New session",
	"new-shell-terminal": "New terminal",
	"close-shell-terminal": "Close terminal",
	"keyboard-shortcuts": "Show keyboard shortcuts",
	"command-palette": "Open command palette",
	"open-settings": "Open settings",
	"toggle-sidebar": "Toggle sidebar",
	"open-project": "Open project 1–9",
	"previous-session": "Previous session",
	"next-session": "Next session",
	"previous-tab": "Previous tab",
	"next-tab": "Next tab",
	"toggle-inspector": "Toggle inspector",
	"focus-terminal": "Focus terminal",
};

export const shortcutCategoryLabels: Record<ShortcutCategory, string> = {
	General: "General",
	Navigation: "Navigation",
	Session: "Session",
};
