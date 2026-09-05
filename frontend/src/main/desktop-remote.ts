import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "electron";
import {
	coerceDesktopRemoteConfig,
	type DesktopRemoteConfig,
	DESKTOP_REMOTE_FILE_NAME,
	remoteConnectOrigins,
	type ParsedRemotePairing,
	parseRemotePairingInput,
	resolveRemotePairingInput,
	probeRemoteIdentity,
	publicRemoteConfig,
	remoteApiBaseUrl,
	isPairedRemoteRequestUrl,
	verifyRemoteAuth,
} from "../shared/desktop-remote";

export type { DesktopRemoteConfig, ParsedRemotePairing };
export {
	parseRemotePairingInput,
	resolveRemotePairingInput,
	probeRemoteIdentity,
	verifyRemoteAuth,
	remoteApiBaseUrl,
	remoteConnectOrigins,
	isPairedRemoteRequestUrl,
	publicRemoteConfig,
	DESKTOP_REMOTE_FILE_NAME,
};

let activeRemoteConfig: DesktopRemoteConfig | null = null;
let remoteRequestAuthConfig: DesktopRemoteConfig | null = null;
let remoteRequestHookInstalled = false;

export function getRemoteAuthHeader(): Record<string, string> | null {
	const config = remoteRequestAuthConfig ?? activeRemoteConfig;
	if (!config?.enabled) return null;
	return { Authorization: `Bearer ${config.password}` };
}

export function getActiveRemoteConfig(): DesktopRemoteConfig | null {
	return activeRemoteConfig;
}

export async function readDesktopRemoteConfig(stateDir: string): Promise<DesktopRemoteConfig | null> {
	let raw: string;
	try {
		raw = await readFile(path.join(stateDir, DESKTOP_REMOTE_FILE_NAME), "utf8");
	} catch {
		return null;
	}
	try {
		return coerceDesktopRemoteConfig(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function writeDesktopRemoteConfig(stateDir: string, config: DesktopRemoteConfig): Promise<void> {
	await mkdir(stateDir, { recursive: true, mode: 0o750 });
	const file = path.join(stateDir, DESKTOP_REMOTE_FILE_NAME);
	const data = `${JSON.stringify(config, null, 2)}\n`;
	const tmp = path.join(stateDir, `.desktop-remote-${process.pid}-${Date.now()}.json`);
	await writeFile(tmp, data, { mode: 0o600 });
	await rename(tmp, file);
	activeRemoteConfig = config;
}

export async function clearDesktopRemoteConfig(stateDir: string): Promise<void> {
	const file = path.join(stateDir, DESKTOP_REMOTE_FILE_NAME);
	try {
		await rm(file);
	} catch {
		// missing file is fine
	}
	activeRemoteConfig = null;
	remoteRequestAuthConfig = null;
}

export function pairingToRemoteConfig(
	pairing: ParsedRemotePairing,
	verifiedHostId: string,
): DesktopRemoteConfig {
	return {
		enabled: true,
		host: pairing.host,
		port: pairing.port,
		password: pairing.password,
		secure: pairing.secure,
		hostId: verifiedHostId || pairing.hostId,
	};
}

export function manualPairingInput(host: string, port: number, password: string, secure: boolean): ParsedRemotePairing {
	return { host, port, password, secure, hostId: "" };
}

export async function validateRemotePairing(
	pairing: ParsedRemotePairing,
	fetchImpl: typeof fetch,
): Promise<{ config: DesktopRemoteConfig } | { error: string }> {
	if (!pairing.host || pairing.port <= 0) {
		return { error: "Host and port are required." };
	}
	if (!pairing.password) {
		return { error: "Connection password is required." };
	}
	const baseUrl = remoteApiBaseUrl(pairing);
	const identity = await probeRemoteIdentity(baseUrl, fetchImpl);
	if (!identity.ok) {
		if (identity.reason === "network") return { error: "Could not reach that host. Check the address and network." };
		return { error: "That host is not an AO daemon." };
	}
	if (pairing.hostId && pairing.hostId !== identity.hostId) {
		return { error: "Host identity does not match the pairing code." };
	}
	const authed = await verifyRemoteAuth(baseUrl, pairing.password, fetchImpl);
	if (!authed) {
		return { error: "Connection password was rejected." };
	}
	return { config: pairingToRemoteConfig(pairing, identity.hostId) };
}

export function installRemoteRequestHook(session: Session, config: DesktopRemoteConfig): void {
	remoteRequestAuthConfig = config;
	activeRemoteConfig = config;
	const filter = { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] };
	const install = () => {
		session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
			const cfg = remoteRequestAuthConfig;
			if (!cfg?.enabled) {
				callback({ requestHeaders: details.requestHeaders as Record<string, string> });
				return;
			}
			if (!isPairedRemoteRequestUrl(details.url, cfg)) {
				callback({ requestHeaders: details.requestHeaders as Record<string, string> });
				return;
			}
			const headers: Record<string, string> = {
				...(details.requestHeaders as Record<string, string>),
				Authorization: `Bearer ${cfg.password}`,
			};
			// Match mobile mux: loopback Origin passes the daemon WS upgrade guard.
			if (details.url.includes("/mux")) {
				headers.Origin = "http://127.0.0.1";
			}
			callback({ requestHeaders: headers });
		});
	};
	if (remoteRequestHookInstalled) return;
	install();
	remoteRequestHookInstalled = true;
}

export function remoteCspConnectOrigins(config: DesktopRemoteConfig): string[] {
	return remoteConnectOrigins(config);
}
