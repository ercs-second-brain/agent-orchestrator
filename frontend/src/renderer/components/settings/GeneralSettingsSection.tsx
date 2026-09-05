import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThemePreference, ThemeStyle } from "../../lib/theme";
import type { AppLocale } from "../../i18n";
import { useLocaleStore } from "../../stores/locale-store";
import { useSoundNotificationsStore } from "../../stores/sound-notifications-store";
import { useUiStore } from "../../stores/ui-store";
import { useTelemetryPolicyStore } from "../../stores/telemetry-policy-store";
import { useTerminalShellStore } from "../../stores/terminal-shell-store";
import { SettingsOptionMenu, type SettingsOption } from "./SettingsOptionMenu";
import { SettingsInputRow, SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";
import { useSettings, useUpdateSessionInterface } from "../../hooks/useSettings";
import type { SessionMode } from "../../types/workspace";
import type { TerminalShellKind } from "../../../shared/ui-locale";
import { isWindowsPlatform } from "../../lib/platform";
import { RemoteConnectionSection } from "./RemoteConnectionSection";

/**
 * Default interface for new sessions. Daemon-owned so `ao spawn` and mobile
 * resolve the same value. Only affects sessions created afterwards — a
 * session's interface is fixed when it is born.
 */
function SessionInterfaceRow() {
	const { settings, isLoading, error } = useSettings();
	const { update, saving, error: saveError } = useUpdateSessionInterface();
	const interfaceOptions = [
		{ value: "tui", label: "Terminal" },
		{ value: "chat", label: "Chat" },
	] satisfies SettingsOption<SessionMode>[];

	const chatAvailable = (settings?.chatHarnesses.length ?? 0) > 0;
	// Silent when everything works; speak up only when the control is limited
	// (no chat-capable agent installed) or a save failed.
	const note = saveError ?? error ?? (!chatAvailable ? "Applies to new sessions. No installed agent supports chat yet." : null);

	return (
		<div className="flex w-full flex-col">
			<SettingsRow className="rounded-none" label={"Default session interface"}>
				<SettingsOptionMenu
					aria-label={"Default session interface"}
					value={settings?.defaultSessionMode ?? "tui"}
					options={interfaceOptions}
					onChange={(mode) => update(mode)}
					disabled={isLoading || saving || !chatAvailable}
				/>
			</SettingsRow>
			{note ? (
				<p
					className={cn(
						"px-3 pt-0 pb-4 text-xs leading-relaxed",
						saveError || error ? "text-destructive" : "text-muted-foreground",
					)}
				>
					{note}
				</p>
			) : null}
		</div>
	);
}

function TerminalShellRows() {
	const preference = useTerminalShellStore((state) => state.preference);
	const load = useTerminalShellStore((state) => state.load);
	const setPreference = useTerminalShellStore((state) => state.setPreference);
	const saving = useTerminalShellStore((state) => state.saving);
	const saveError = useTerminalShellStore((state) => state.saveError);
	const [customPath, setCustomPath] = useState(preference.path ?? "");

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		setCustomPath(preference.path ?? "");
	}, [preference.path]);

	const shellOptions = [
		{ value: "auto", label: "Automatic" },
		{ value: "git-bash", label: "Git Bash" },
		{ value: "pwsh", label: "PowerShell" },
		{ value: "powershell", label: "Windows PowerShell" },
		{ value: "cmd", label: "Command Prompt" },
		{ value: "custom", label: "Custom path" },
	] satisfies SettingsOption<TerminalShellKind>[];

	return (
		<>
			<SettingsRow label={"Default terminal"}>
				<SettingsOptionMenu
					aria-label={"Default terminal"}
					value={preference.kind}
					options={shellOptions}
					disabled={saving}
					onChange={(kind) => {
						void setPreference(kind === "custom" ? { kind, path: customPath } : { kind });
					}}
				/>
			</SettingsRow>
			{preference.kind === "custom" ? (
				<SettingsInputRow
					id="terminal-shell-custom-path"
					label={"Shell executable"}
					value={customPath}
					onChange={setCustomPath}
					onCommit={(path) => void setPreference({ kind: "custom", path })}
					onCancel={() => setCustomPath(preference.path ?? "")}
					placeholder={"C:\\path\\to\\shell.exe"}
				/>
			) : null}
			{saveError ? (
				<p role="alert" className="px-3 text-caption leading-4 text-error">
					{"Could not save the default terminal."}
				</p>
			) : null}
		</>
	);
}

const COLOR_THEME_OPTIONS = [
	{ value: "orchestrate", label: "Orchestrate" },
	{ value: "github", label: "GitHub" },
	{ value: "catppuccin", label: "Catppuccin" },
	{ value: "dracula", label: "Dracula" },
	{ value: "tokyo-night", label: "Tokyo Night" },
	{ value: "rose-pine", label: "Rosé Pine" },
	{ value: "nord", label: "Nord" },
	{ value: "gruvbox", label: "Gruvbox" },
	{ value: "solarized", label: "Solarized" },
] satisfies SettingsOption<ThemeStyle>[];

export function GeneralSettingsSection({
	titleHidden,
}: {
	titleHidden?: boolean;
}) {
	const themePreference = useUiStore((state) => state.themePreference);
	const setThemePreference = useUiStore((state) => state.setThemePreference);
	const themeStyle = useUiStore((state) => state.themeStyle);
	const setThemeStyle = useUiStore((state) => state.setThemeStyle);
	const locale = useLocaleStore((state) => state.locale);
	const setLocale = useLocaleStore((state) => state.setLocale);
	const localeSaving = useLocaleStore((state) => state.saving);
	const localeSaveError = useLocaleStore((state) => state.saveError);
	const soundNotificationsEnabled = useSoundNotificationsStore((state) => state.enabled);
	const setSoundNotificationsEnabled = useSoundNotificationsStore((state) => state.setEnabled);
	const soundNotificationsSaving = useSoundNotificationsStore((state) => state.saving);
	const soundNotificationsSaveError = useSoundNotificationsStore((state) => state.saveError);
	const developerMode = useUiStore((state) => state.developerMode);
	const setDeveloperMode = useUiStore((state) => state.setDeveloperMode);

	const themeOptions = [
		{ value: "light", label: "Light" },
		{ value: "dark", label: "Dark" },
		{ value: "system", label: "System" },
	] satisfies SettingsOption<ThemePreference>[];

	const languageOptions = [
		{ value: "en", label: "English" },
		{ value: "zh-CN", label: "Simplified Chinese" },
		{ value: "ja", label: "日本語" },
		{ value: "ko", label: "한국어" },
		{ value: "es", label: "Español" },
		{ value: "fr", label: "Français" },
		{ value: "de", label: "Deutsch" },
		{ value: "pt-BR", label: "Português (Brasil)" },
	] satisfies SettingsOption<AppLocale>[];

	return (
		<>
			<RemoteConnectionSection titleHidden={titleHidden} />
			{/* Appearance */}
			<SettingsSection title={"Appearance"} titleHidden={titleHidden} grouped>
				<SettingsRow label={"Theme"}>
					<div className="flex items-center gap-1.5">
						<SettingsOptionMenu
							aria-label={"Color Theme"}
							value={themeStyle}
							options={COLOR_THEME_OPTIONS}
							onChange={setThemeStyle}
						/>
						<SettingsOptionMenu
							aria-label={"Theme"}
							value={themePreference}
							options={themeOptions}
							onChange={setThemePreference}
						/>
					</div>
				</SettingsRow>
				<SettingsRow label={"Language"}>
					<SettingsOptionMenu
						aria-label={"Language"}
						disabled={localeSaving}
						value={locale}
						options={languageOptions}
						onChange={(next) => {
							void setLocale(next);
						}}
					/>
				</SettingsRow>
				{localeSaveError ? (
					<p role="alert" className="px-3 text-caption leading-4 text-error">
						{"Could not save the language preference."}
					</p>
				) : null}
			</SettingsSection>

			{/* Sessions */}
			<SettingsSection title={"Sessions"} grouped>
				<SessionInterfaceRow />
				{isWindowsPlatform() ? <TerminalShellRows /> : null}
				<SettingsRow label={"Sound notifications"}>
					<Switch
						aria-label={"Sound notifications"}
						checked={soundNotificationsEnabled}
						disabled={soundNotificationsSaving}
						onCheckedChange={(next) => {
							void setSoundNotificationsEnabled(next);
						}}
					/>
				</SettingsRow>
				{soundNotificationsSaveError ? (
					<p role="alert" className="px-3 text-caption leading-4 text-error">
						{"Could not save the sound notifications preference."}
					</p>
				) : null}
			</SettingsSection>

			<SettingsSection title={"Privacy"} grouped>
				<TelemetryEventsRow />
			</SettingsSection>

			{/* Advanced */}
			<SettingsSection title={"Advanced"} grouped>
				<SettingsRow label={"Developer Mode"}>
					<Switch
						aria-label={"Developer Mode"}
						checked={developerMode}
						onCheckedChange={setDeveloperMode}
					/>
				</SettingsRow>
			</SettingsSection>
		</>
	);
}

function TelemetryEventsRow() {
	const view = useTelemetryPolicyStore((state) => state.view);
	const saving = useTelemetryPolicyStore((state) => state.saving);
	const saveError = useTelemetryPolicyStore((state) => state.saveError);
	const setEnabled = useTelemetryPolicyStore((state) => state.setEnabled);
	const checked = view?.eventsEnabled ?? false;
	const blockedEnable = !checked && (view?.environmentVeto || !view?.durabilitySupported);
	const status = saveError || view?.state === "cleanup_failed" ? "failed" : view?.state === "cleanup_pending" ? "pending" : view?.reason === "environment_veto" ? "veto" : view?.reason === "durability_unsupported" ? "unsupported" : view?.reason === "release_blocked" ? "releaseBlocked" : null;
	return <div className="flex w-full flex-col">
		<SettingsRow label={"Share error events"}>
			<Switch aria-label={"Share error events"} checked={checked} disabled={saving || !view || blockedEnable} onCheckedChange={(enabled) => { void setEnabled(enabled); }} />
		</SettingsRow>
		<p className={cn("px-3 pb-2 text-xs leading-relaxed", status === "failed" ? "text-destructive" : "text-muted-foreground")} role={status === "failed" ? "alert" : undefined}>
			{t(status ? `settings.telemetryEvents.${status}` : "settings.telemetryEvents.description")}
		</p>
	</div>;
}
