/**
 * Whether the desktop environment allows telemetry export at all.
 *
 * Unpackaged builds are off by default so a developer's ordinary session does
 * not produce real-install traffic. Setting `AO_TELEMETRY_RENDERER=on` opts a
 * dev build back in for deliberate testing.
 */
export function rendererTelemetryEnabled(
	env: Record<string, string | undefined>,
	isPackaged: boolean,
): boolean {
	const explicit = env.AO_TELEMETRY_RENDERER?.trim().toLowerCase();
	if (explicit === "on") return true;
	if (explicit === "off") return false;
	return isPackaged;
}
