import { describe, expect, it, vi } from "vitest";

// The multi-harness picker UX this suite covered is gone with ADR 0005 (pi is
// the single supported harness). The agents section now renders a fixed pi
// field; remaining project-settings behavior is exercised by daemon-side
// service tests and the API contract suite.
describe("ProjectSettingsForm (single-agent)", () => {
	it("is importable after the picker removal", async () => {
		const mod = await import("./ProjectSettingsForm");
		expect(typeof mod.ProjectSettingsForm).toBe("function");
	});
});
