import { describe, expect, it } from "vitest";
import { patchRendererCspHtml, patchRendererCspMeta } from "./desktop-remote-csp";

describe("patchRendererCspHtml", () => {
	it("adds paired origins to connect-src in built index.html", () => {
		const html =
			'<!doctype html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; connect-src &#39;self&#39; http://127.0.0.1:*"></head><body></body>';
		const patched = patchRendererCspHtml(html, ["http://192.168.1.50:3011", "ws://192.168.1.50:3011"]);
		expect(patched).toContain("http://192.168.1.50:3011");
		expect(patched).toContain("ws://192.168.1.50:3011");
		expect(patched).toContain("connect-src &#39;self&#39; http://127.0.0.1:*");
	});

	it("patches the packaged renderer index.html without corrupting CSP", () => {
		const html = `<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;self&#39;; connect-src &#39;self&#39; http://127.0.0.1:* ws://127.0.0.1:*">`;
		const patched = patchRendererCspHtml(`<head>${html}</head>`, ["http://192.168.0.22:3011"]);
		expect(patched).toContain("script-src &#39;self&#39;");
		expect(patched).toMatch(/connect-src &#39;self&#39; http:\/\/127\.0\.0\.1:\* ws:\/\/127\.0\.0\.1:\* http:\/\/192\.168\.0\.22:3011/);
	});
});

describe("patchRendererCspMeta", () => {
	it("adds paired origins to connect-src and img-src", () => {
		document.head.innerHTML =
			'<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' http://127.0.0.1:*; img-src \'self\' data:">';
		patchRendererCspMeta(["http://192.168.1.50:3011", "ws://192.168.1.50:3011"]);
		const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
		const content = meta?.getAttribute("content") ?? "";
		expect(content).toContain("http://192.168.1.50:3011");
		expect(content).toContain("ws://192.168.1.50:3011");
	});
});
