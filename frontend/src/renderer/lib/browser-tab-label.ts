export function browserTabLabel(title: string, url: string): { title: string; subtitle: string } {
	const cleanTitle = title.trim();
	if (!url) return { title: cleanTitle || "New tab", subtitle: "Blank page" };
	try {
		const parsed = new URL(url);
		const subtitle = parsed.protocol === "file:" ? parsed.pathname.split("/").filter(Boolean).at(-1) || url : parsed.host;
		return { title: cleanTitle || subtitle, subtitle };
	} catch {
		return { title: cleanTitle || url, subtitle: url };
	}
}
