import { ipcMain, net, session, type WebContents } from "electron";
import type { DaemonStatus } from "../shared/daemon-status";
import { probeRemoteIdentity, verifyRemoteAuth } from "../shared/desktop-remote";
import {
	clearDesktopRemoteConfig,
	getActiveRemoteConfig,
	getRemoteAuthHeader,
	installRemoteRequestHook,
	publicRemoteConfig,
	readDesktopRemoteConfig,
	remoteApiBaseUrl,
	remoteCspConnectOrigins,
	resolveRemotePairingInput,
	validateRemotePairing,
	writeDesktopRemoteConfig,
	type DesktopRemoteConfig,
} from "./desktop-remote";

export type RemoteDaemonDeps = {
	dataDir: string;
	getShellWebContents: () => WebContents | null;
	setDaemonStatus: (status: DaemonStatus) => void;
	startLocalDaemon: () => Promise<DaemonStatus>;
	stopLocalDaemon: () => DaemonStatus;
};

export function createRemoteDaemonController(deps: RemoteDaemonDeps) {
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		if (input instanceof URL) {
			return net.fetch(input.toString(), init);
		}
		if (typeof input === "string") {
			return net.fetch(input, init);
		}
		return net.fetch(input.url, { ...init, method: input.method, headers: input.headers, body: input.body as BodyInit | undefined });
	}) as typeof fetch;

	async function attachRemoteDaemon(config: DesktopRemoteConfig): Promise<boolean> {
		const baseUrl = remoteApiBaseUrl(config);
		const identity = await probeRemoteIdentity(baseUrl, fetchImpl);
		if (!identity.ok) {
			deps.setDaemonStatus({
				state: "error",
				connectionMode: "remote",
				remoteApiBase: baseUrl,
				code: "remote_unreachable",
				message: "Could not reach the remote AO server.",
			});
			return false;
		}
		if (config.hostId && config.hostId !== identity.hostId) {
			deps.setDaemonStatus({
				state: "error",
				connectionMode: "remote",
				remoteApiBase: baseUrl,
				code: "identity_mismatch",
				message: "The remote host identity changed. Pair again.",
			});
			return false;
		}
		const authed = await verifyRemoteAuth(baseUrl, config.password, fetchImpl);
		if (!authed) {
			deps.setDaemonStatus({
				state: "error",
				connectionMode: "remote",
				remoteApiBase: baseUrl,
				code: "remote_auth_failed",
				message: "The connection password was rejected.",
			});
			return false;
		}
		const merged: DesktopRemoteConfig = { ...config, hostId: identity.hostId };
		await writeDesktopRemoteConfig(deps.dataDir, merged);
		installRemoteRequestHook(session.defaultSession, merged);
		deps.setDaemonStatus({
			state: "ready",
			connectionMode: "remote",
			remoteApiBase: baseUrl,
			remoteHostId: identity.hostId,
		});
		deps.getShellWebContents()?.send("desktop-remote:csp", remoteCspConnectOrigins(merged));
		return true;
	}

	async function bootRemoteOrLocal(): Promise<void> {
		const stored = await readDesktopRemoteConfig(deps.dataDir);
		if (stored?.enabled) {
			const attached = await attachRemoteDaemon(stored);
			if (attached) return;
			await clearDesktopRemoteConfig(deps.dataDir);
		}
		void deps.startLocalDaemon();
	}

	async function connectRemote(input: {
		pairingText?: string;
		host?: string;
		port?: number;
		password?: string;
		secure?: boolean;
	}): Promise<{ ok: true; config: ReturnType<typeof publicRemoteConfig> } | { ok: false; error: string }> {
		const pairing = resolveRemotePairingInput(input);
		if (!pairing) {
			return { ok: false, error: "Enter host, port, and password, or paste a pairing code." };
		}
		const validated = await validateRemotePairing(pairing, fetchImpl);
		if ("error" in validated) {
			return { ok: false, error: validated.error };
		}
		deps.stopLocalDaemon();
		const attached = await attachRemoteDaemon(validated.config);
		if (!attached) {
			void deps.startLocalDaemon();
			return { ok: false, error: "Could not attach to the remote AO server." };
		}
		const shell = deps.getShellWebContents();
		if (shell && !shell.isDestroyed()) {
			// The first page load only allows loopback in CSP. Re-serve index.html so
			// the custom protocol handler injects the paired LAN origin before fetch/SSE.
			shell.reload();
		}
		return { ok: true, config: publicRemoteConfig(getActiveRemoteConfig() ?? validated.config) };
	}

	async function disconnectRemote(): Promise<DaemonStatus> {
		await clearDesktopRemoteConfig(deps.dataDir);
		deps.setDaemonStatus({ state: "stopped" });
		return deps.startLocalDaemon();
	}

	async function getPublicConfig(): Promise<ReturnType<typeof publicRemoteConfig> | null> {
		const config = getActiveRemoteConfig() ?? (await readDesktopRemoteConfig(deps.dataDir));
		return config?.enabled ? publicRemoteConfig(config) : null;
	}

	function installIpc(): void {
		ipcMain.handle("desktop-remote:getConfig", () => getPublicConfig());
		ipcMain.handle("desktop-remote:getCspOrigins", () => {
			const config = getActiveRemoteConfig();
			return config ? remoteCspConnectOrigins(config) : [];
		});
		ipcMain.handle("desktop-remote:getAuthHeader", () => getRemoteAuthHeader());
		ipcMain.handle("desktop-remote:connect", (_event, input) => connectRemote(input ?? {}));
		ipcMain.handle("desktop-remote:disconnect", () => disconnectRemote());
		ipcMain.handle("desktop-remote:probe", async (_event, input: { host: string; port: number; secure?: boolean }) => {
			if (!input || typeof input.host !== "string" || typeof input.port !== "number") {
				return { ok: false as const, reason: "not_ao" as const };
			}
			return probeRemoteIdentity(remoteApiBaseUrl({ host: input.host, port: input.port, secure: input.secure === true }), fetchImpl);
		});
	}

	return { bootRemoteOrLocal, attachRemoteDaemon, installIpc, getPublicConfig };
}
