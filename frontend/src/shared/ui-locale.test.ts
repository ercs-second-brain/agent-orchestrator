import { describe, expect, it } from "vitest";
import { DEFAULT_UI_SETTINGS, coerceTerminalShell, coerceUiSettings } from "./ui-locale";

describe("shared UI settings schema", () => {
	it("ignores a persisted locale key left over from earlier versions", () => {
		expect(coerceUiSettings({ locale: "zh-CN" })).toEqual(DEFAULT_UI_SETTINGS);
		expect(coerceUiSettings({ locale: "ja" })).toEqual(DEFAULT_UI_SETTINGS);
		expect(coerceUiSettings({ locale: "pt-BR" })).toEqual(DEFAULT_UI_SETTINGS);
		expect(coerceUiSettings({ locale: "pt" })).toEqual(DEFAULT_UI_SETTINGS);
		expect(coerceUiSettings(null)).toEqual(DEFAULT_UI_SETTINGS);
	});

	it("defaults soundNotificationsEnabled to true and accepts a persisted boolean", () => {
		expect(DEFAULT_UI_SETTINGS).toEqual({
			soundNotificationsEnabled: true,
			terminalShell: { kind: "auto" },
		});
		expect(coerceUiSettings({ soundNotificationsEnabled: false })).toEqual({
			...DEFAULT_UI_SETTINGS,
			soundNotificationsEnabled: false,
		});
		expect(coerceUiSettings({ soundNotificationsEnabled: true })).toEqual({
			...DEFAULT_UI_SETTINGS,
			soundNotificationsEnabled: true,
		});
	});

	it("coerces a non-boolean or missing soundNotificationsEnabled to the default (true)", () => {
		expect(coerceUiSettings({})).toEqual(DEFAULT_UI_SETTINGS);
		expect(coerceUiSettings({ soundNotificationsEnabled: "false" })).toEqual({
			...DEFAULT_UI_SETTINGS,
		});
		expect(coerceUiSettings({ soundNotificationsEnabled: null })).toEqual({
			...DEFAULT_UI_SETTINGS,
		});
	});

	it("accepts supported terminal shells and normalizes custom paths", () => {
		expect(coerceTerminalShell({ kind: "git-bash" })).toEqual({ kind: "git-bash" });
		expect(coerceTerminalShell({ kind: "custom", path: "  C:\\Tools\\bash.exe  " })).toEqual({
			kind: "custom",
			path: "C:\\Tools\\bash.exe",
		});
		expect(coerceTerminalShell({ kind: "custom", path: "   " })).toEqual({ kind: "custom" });
		expect(coerceTerminalShell({ kind: "fish" })).toEqual({ kind: "auto" });
	});
});
