import { existsSync } from "node:fs";
import path from "node:path";
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import type { TrayAttentionState, TrayAttentionZone, TrayOpenSessionTarget, TraySessionEntry } from "../shared/tray";

const MAX_MENU_SESSIONS = 8;

const zoneRank: Record<TrayAttentionZone, number> = { merge: 0, action: 1 };

const zoneLabels: Record<TrayAttentionZone, string> = { merge: "Ready to merge", action: "Needs you" };

function trayIconPath(): string | undefined {
	const candidate = app.isPackaged
		? path.join(process.resourcesPath, "trayIconTemplate.png")
		: path.join(__dirname, "../../assets/trayIconTemplate.png");
	return existsSync(candidate) ? candidate : undefined;
}

export type TrayController = {
	setState(state: TrayAttentionState): void;
	clear(): void;
	dispose(): void;
};

export type TrayControllerOptions = {
	focusWindow: () => void;
	openSession: (target: TrayOpenSessionTarget) => void;
};

export function createTrayController(options: TrayControllerOptions): TrayController | null {
	const iconPath = trayIconPath();
	if (!iconPath) return null;
	const icon = nativeImage.createFromPath(iconPath);
	if (icon.isEmpty()) return null;
	icon.setTemplateImage(true);

	const tray = new Tray(icon);
	let sessions: TraySessionEntry[] = [];

	const attentionTooltip = (count: number): string =>
		count === 1 ? "1 session needs attention" : `${count} sessions need attention`;

	const sessionItem = (entry: TraySessionEntry): MenuItemConstructorOptions => {
		const title = entry.title || "Untitled session";
		return {
			label: entry.projectName ? `${title}  ·  ${entry.projectName}` : title,
			click: () => options.openSession({ projectId: entry.projectId, sessionId: entry.sessionId }),
		};
	};

	const render = () => {
		const count = sessions.length;
		tray.setTitle(count > 0 ? String(count) : "");
		tray.setToolTip(count > 0 ? attentionTooltip(count) : "Agent Orchestrator");

		const items: MenuItemConstructorOptions[] = [];
		if (count === 0) {
			items.push({ label: "No sessions need attention", enabled: false });
		} else {
			const ordered = [...sessions].sort(
				(a, b) => zoneRank[a.zone] - zoneRank[b.zone] || a.title.localeCompare(b.title),
			);
			const visible = ordered.slice(0, MAX_MENU_SESSIONS);
			const overflow = ordered.slice(MAX_MENU_SESSIONS);

			let lastZone: TrayAttentionZone | null = null;
			for (const entry of visible) {
				if (entry.zone !== lastZone) {
					if (lastZone !== null) items.push({ type: "separator" });
					items.push({ label: zoneLabels[entry.zone], enabled: false });
					lastZone = entry.zone;
				}
				items.push(sessionItem(entry));
			}
			if (overflow.length > 0) {
				items.push({ type: "separator" });
				items.push({ label: `More (${overflow.length})`, submenu: overflow.map(sessionItem) });
			}
		}
		items.push({ type: "separator" });
		items.push({ label: "Show Agent Orchestrator", click: () => options.focusWindow() });
		items.push({ label: "Quit Agent Orchestrator", role: "quit" });
		tray.setContextMenu(Menu.buildFromTemplate(items));
	};

	render();

	return {
		setState(state) {
			sessions = state.sessions ?? [];
			render();
		},
		clear() {
			sessions = [];
			render();
		},
		dispose() {
			tray.destroy();
		},
	};
}
