import { describe, expect, it, vi } from "vitest";
import {
	coerceDesktopRemoteConfig,
	parseRemotePairingInput,
	resolveRemotePairingInput,
	probeRemoteIdentity,
	remoteApiBaseUrl,
	remoteConnectOrigins,
	isPairedRemoteRequestUrl,
	verifyRemoteAuth,
} from "./desktop-remote";

describe("parseRemotePairingInput", () => {
	it("parses v1 JSON payloads", () => {
		expect(
			parseRemotePairingInput(
				JSON.stringify({ v: 1, host: "192.168.1.50", port: 3011, password: "secret12" }),
			),
		).toEqual({
			host: "192.168.1.50",
			port: 3011,
			password: "secret12",
			secure: false,
			hostId: "",
		});
	});

	it("parses v2 base64url pairing codes", () => {
		const offer = {
			v: 2,
			hostId: "h_test",
			name: "vm",
			platform: "linux",
			token: "pw123456",
			endpoints: [{ kind: "lan", host: "10.0.0.5", port: 3011, secure: false }],
		};
		const code = btoa(JSON.stringify(offer)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		expect(parseRemotePairingInput(code)).toEqual({
			host: "10.0.0.5",
			port: 3011,
			password: "pw123456",
			secure: false,
			hostId: "h_test",
		});
	});
});

describe("resolveRemotePairingInput", () => {
	it("prefers pasted pairing JSON over blank manual fields", () => {
		expect(
			resolveRemotePairingInput({
				pairingText: JSON.stringify({ v: 1, host: "192.168.0.22", port: 3011, password: "secret12" }),
				host: "",
				port: "",
				password: "",
			}),
		).toEqual({
			host: "192.168.0.22",
			port: 3011,
			password: "secret12",
			secure: false,
			hostId: "",
		});
	});

	it("falls back to manual host, port, and password", () => {
		expect(
			resolveRemotePairingInput({
				host: "192.168.0.22",
				port: 3011,
				password: "secret12",
			}),
		).toEqual({
			host: "192.168.0.22",
			port: 3011,
			password: "secret12",
			secure: false,
			hostId: "",
		});
	});
});

describe("coerceDesktopRemoteConfig", () => {
	it("requires enabled, host, port, and password", () => {
		expect(
			coerceDesktopRemoteConfig({
				enabled: true,
				host: "192.168.1.50",
				port: 3011,
				password: "secret12",
				hostId: "h_abc",
			}),
		).toEqual({
			enabled: true,
			host: "192.168.1.50",
			port: 3011,
			password: "secret12",
			secure: false,
			hostId: "h_abc",
		});
	});
});

describe("remoteApiBaseUrl", () => {
	it("builds http and ws origins", () => {
		expect(remoteApiBaseUrl({ host: "192.168.1.50", port: 3011, secure: false })).toBe(
			"http://192.168.1.50:3011",
		);
		expect(remoteConnectOrigins({ host: "192.168.1.50", port: 3011, secure: false })).toEqual([
			"http://192.168.1.50:3011",
			"ws://192.168.1.50:3011",
		]);
	});
});

describe("isPairedRemoteRequestUrl", () => {
	const lan = { host: "192.168.0.22", port: 3011, secure: false };

	it("matches REST and the mux WebSocket on the paired origin", () => {
		expect(isPairedRemoteRequestUrl("http://192.168.0.22:3011/api/v1/sessions", lan)).toBe(true);
		expect(isPairedRemoteRequestUrl("ws://192.168.0.22:3011/mux", lan)).toBe(true);
		expect(isPairedRemoteRequestUrl("http://192.168.0.22:3011/mux", lan)).toBe(true);
	});

	it("does not match a neighboring port or a different host", () => {
		expect(isPairedRemoteRequestUrl("ws://192.168.0.22:30110/mux", lan)).toBe(false);
		expect(isPairedRemoteRequestUrl("http://127.0.0.1:3001/mux", lan)).toBe(false);
	});

	it("matches wss when the pairing is secure", () => {
		const tunneled = { host: "ao.example", port: 443, secure: true };
		expect(isPairedRemoteRequestUrl("wss://ao.example:443/mux", tunneled)).toBe(true);
		expect(isPairedRemoteRequestUrl("ws://ao.example:443/mux", tunneled)).toBe(false);
	});
});

describe("probeRemoteIdentity", () => {
	it("probes identity before password auth", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({ hostId: "h_vm", apiVersion: 1 }),
		) as unknown as typeof fetch;
		const result = await probeRemoteIdentity("http://192.168.1.50:3011", fetchImpl);
		expect(result).toEqual({ ok: true, hostId: "h_vm", apiVersion: 1 });
		expect(fetchImpl).toHaveBeenCalledWith(
			"http://192.168.1.50:3011/api/v1/identity",
			expect.objectContaining({ method: "GET" }),
		);
	});
});

describe("verifyRemoteAuth", () => {
	it("checks bearer auth against projects", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
			expect(init?.headers).toEqual({ Authorization: "Bearer secret12" });
			return new Response("", { status: 200 });
		}) as unknown as typeof fetch;
		await expect(verifyRemoteAuth("http://192.168.1.50:3011", "secret12", fetchImpl)).resolves.toBe(true);
	});
});
