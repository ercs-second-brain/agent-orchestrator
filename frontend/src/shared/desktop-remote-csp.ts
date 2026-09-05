/** Patch the renderer CSP meta tag to allow paired remote daemon origins. */

function decodeHtmlEntities(value: string): string {
	return value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function encodeHtmlEntities(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

function patchCspContent(content: string, origins: readonly string[]): string {
	if (origins.length === 0) return content;
	const parts = content.split(";").map((part) => part.trim()).filter(Boolean);
	const next = parts.map((part) => {
		if (!part.startsWith("connect-src ") && !part.startsWith("img-src ")) return part;
		const tokens = part.split(/\s+/);
		for (const origin of origins) {
			if (!tokens.includes(origin)) tokens.push(origin);
		}
		return tokens.join(" ");
	});
	return next.join("; ");
}

/** Inject paired remote origins into a built index.html CSP meta tag. */
export function patchRendererCspHtml(html: string, origins: readonly string[]): string {
	if (origins.length === 0) return html;
	return html.replace(
		/(<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=")([^"]*)("[^>]*>)/i,
		(_match, prefix: string, content: string, suffix: string) => {
			const decoded = decodeHtmlEntities(content);
			const patched = patchCspContent(decoded, origins);
			return `${prefix}${encodeHtmlEntities(patched)}${suffix}`;
		},
	);
}

export function patchRendererCspMeta(origins: readonly string[]): void {
	if (typeof document === "undefined" || origins.length === 0) return;
	const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
	if (!meta) return;
	const content = meta.getAttribute("content");
	if (!content) return;
	meta.setAttribute("content", patchCspContent(content, origins));
}
