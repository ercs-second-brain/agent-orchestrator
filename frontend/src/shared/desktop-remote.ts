/**
 * Desktop remote-daemon pairing: parse payloads and build API base URLs.
 * Shared between Electron main and the renderer (pure, no Node/Electron deps).
 */

export type RemoteEndpoint = {
	kind: string;
	host: string;
	port: number;
	secure: boolean;
};

export type ParsedRemotePairing = {
	host: string;
	port: number;
	password: string;
	secure: boolean;
	hostId: string;
};

export type DesktopRemoteConfig = {
	enabled: boolean;
	host: string;
	port: number;
	password: string;
	secure: boolean;
	hostId: string;
};

export const DESKTOP_REMOTE_FILE_NAME = "desktop-remote.json";

const PAIRING_LINK_RE = /^(aomobile:\/\/pair|https?:\/\/[^/]+\/pair)/i;

function fromBase64Url(code: string): string | null {
	try {
		const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
		const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
		return atob(b64 + pad);
	} catch {
		return null;
	}
}

function isRemoteEndpoint(value: unknown): value is RemoteEndpoint {
	if (typeof value !== "object" || value === null) return false;
	const e = value as Record<string, unknown>;
	return (
		typeof e.kind === "string" &&
		typeof e.host === "string" &&
		e.host.length > 0 &&
		typeof e.port === "number" &&
		Number.isFinite(e.port) &&
		typeof e.secure === "boolean"
	);
}

function parseV1Object(obj: Record<string, unknown>): ParsedRemotePairing | null {
	if (obj.v !== 1) return null;
	const host = obj.host;
	if (typeof host !== "string" || host.length === 0) return null;
	const portRaw = obj.port;
	const port = typeof portRaw === "number" ? portRaw : typeof portRaw === "string" ? Number.parseInt(portRaw, 10) : NaN;
	if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
	const password = typeof obj.password === "string" ? obj.password : "";
	return {
		host,
		port,
		password,
		secure: obj.secure === true,
		hostId: typeof obj.hostId === "string" ? obj.hostId : "",
	};
}

function parseV2Object(obj: Record<string, unknown>): ParsedRemotePairing | null {
	if (obj.v !== 2) return null;
	if (!Array.isArray(obj.endpoints)) return null;
	const endpoints = obj.endpoints.filter(isRemoteEndpoint);
	if (endpoints.length === 0) return null;
	const prefer = ["lan", "tailscale", "tunnel", "relay"];
	let chosen = endpoints[0];
	for (const kind of prefer) {
		const match = endpoints.find((ep) => ep.kind === kind);
		if (match) {
			chosen = match;
			break;
		}
	}
	return {
		host: chosen.host,
		port: chosen.port,
		password: typeof obj.token === "string" ? obj.token : "",
		secure: chosen.secure,
		hostId: typeof obj.hostId === "string" ? obj.hostId : "",
	};
}

function extractPairingPayload(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const hash = trimmed.indexOf("#");
	if (hash !== -1) {
		if (!PAIRING_LINK_RE.test(trimmed)) return null;
		return trimmed.slice(hash + 1) || null;
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
	return trimmed;
}

/** Parse a pasted pairing code, deep link, or raw v1 JSON. */
export function parseRemotePairingInput(input: string): ParsedRemotePairing | null {
	const payload = extractPairingPayload(input);
	if (!payload) return null;

	let jsonText = payload;
	if (!payload.startsWith("{")) {
		const decoded = fromBase64Url(payload);
		if (!decoded) return null;
		jsonText = decoded;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const obj = parsed as Record<string, unknown>;
	return parseV2Object(obj) ?? parseV1Object(obj);
}

/** Resolve pairing from pasted JSON or manual host/port/password fields. */
export function resolveRemotePairingInput(input: {
	pairingText?: string;
	host?: string;
	port?: number | string;
	password?: string;
	secure?: boolean;
}): ParsedRemotePairing | null {
	const pairingText = typeof input.pairingText === "string" ? input.pairingText.trim() : "";
	if (pairingText) {
		return parseRemotePairingInput(pairingText);
	}
	const host = typeof input.host === "string" ? input.host.trim() : "";
	const port =
		typeof input.port === "number"
			? input.port
			: Number.parseInt(typeof input.port === "string" ? input.port : "", 10);
	const password = typeof input.password === "string" ? input.password : "";
	if (!host || !Number.isFinite(port) || port <= 0 || !password) {
		return null;
	}
	return {
		host,
		port,
		password,
		secure: input.secure === true,
		hostId: "",
	};
}

export function remoteApiBaseUrl(input: { host: string; port: number; secure: boolean }): string {
	const scheme = input.secure ? "https" : "http";
	return `${scheme}://${input.host}:${input.port}`;
}

export function remoteConnectOrigins(input: { host: string; port: number; secure: boolean }): string[] {
	const httpOrigin = remoteApiBaseUrl(input);
	const wsOrigin = httpOrigin.replace(/^http/i, "ws");
	return [httpOrigin, wsOrigin];
}

function urlEqualsOrIsUnder(url: string, base: string): boolean {
	return url === base || url.startsWith(`${base}/`);
}

/**
 * True when url is the paired daemon's HTTP or WebSocket origin.
 * Chromium reports /mux handshakes as ws(s)://, so matching only http(s)://
 * leaves the terminal socket unauthenticated on the LAN listener.
 */
export function isPairedRemoteRequestUrl(
	url: string,
	input: { host: string; port: number; secure: boolean },
): boolean {
	const httpBase = remoteApiBaseUrl(input).replace(/\/+$/, "");
	const wsBase = httpBase.replace(/^http/i, "ws");
	return urlEqualsOrIsUnder(url, httpBase) || urlEqualsOrIsUnder(url, wsBase);
}

export function coerceDesktopRemoteConfig(raw: unknown): DesktopRemoteConfig | null {
	if (typeof raw !== "object" || raw === null) return null;
	const obj = raw as Record<string, unknown>;
	if (obj.enabled !== true) return null;
	const host = obj.host;
	if (typeof host !== "string" || host.length === 0) return null;
	const port = typeof obj.port === "number" ? obj.port : Number.parseInt(String(obj.port ?? ""), 10);
	if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
	const password = typeof obj.password === "string" ? obj.password : "";
	if (password.length === 0) return null;
	return {
		enabled: true,
		host,
		port,
		password,
		secure: obj.secure === true,
		hostId: typeof obj.hostId === "string" ? obj.hostId : "",
	};
}

export type IdentityProbeResult =
	| { ok: true; hostId: string; apiVersion?: number }
	| { ok: false; reason: "network" | "not_ao" | "missing_host_id" };

/** Probe GET /api/v1/identity without credentials. */
export async function probeRemoteIdentity(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<IdentityProbeResult> {
	let response: Response;
	try {
		response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/v1/identity`, {
			method: "GET",
			signal,
		});
	} catch {
		return { ok: false, reason: "network" };
	}
	if (!response.ok) return { ok: false, reason: "not_ao" };
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return { ok: false, reason: "not_ao" };
	}
	if (typeof body !== "object" || body === null) return { ok: false, reason: "not_ao" };
	const hostId = (body as { hostId?: unknown }).hostId;
	if (typeof hostId !== "string" || hostId.length === 0) return { ok: false, reason: "missing_host_id" };
	const apiVersion = (body as { apiVersion?: unknown }).apiVersion;
	return {
		ok: true,
		hostId,
		apiVersion: typeof apiVersion === "number" ? apiVersion : undefined,
	};
}

/** Verify bearer auth against a lightweight authenticated route. */
export async function verifyRemoteAuth(
	baseUrl: string,
	password: string,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/v1/projects`, {
			method: "GET",
			headers: { Authorization: `Bearer ${password}` },
			signal,
		});
		return response.ok;
	} catch {
		return false;
	}
}

export function publicRemoteConfig(config: DesktopRemoteConfig): Omit<DesktopRemoteConfig, "password"> & { hasPassword: true } {
	return {
		enabled: config.enabled,
		host: config.host,
		port: config.port,
		secure: config.secure,
		hostId: config.hostId,
		hasPassword: true,
	};
}
