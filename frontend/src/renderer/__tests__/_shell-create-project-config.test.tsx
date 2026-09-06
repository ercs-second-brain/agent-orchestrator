import { describe, expect, it } from "vitest";
import { createProjectConfig } from "../routes/_shell";

describe("createProjectConfig", () => {
	// ADR 0005: pi is the single supported harness, so the create flow pins both
	// roles to pi; legacy role values from a stale caller must not persist.
	it("pins worker and orchestrator agents to pi", () => {
		expect(
			createProjectConfig({
				workerAgent: "pi",
				orchestratorAgent: "pi",
			}),
		).toEqual({
			worker: { agent: "pi" },
			orchestrator: { agent: "pi" },
		});
	});

	it("preserves tracker intake alongside the agent defaults", () => {
		expect(
			createProjectConfig({
				workerAgent: "pi",
				orchestratorAgent: "pi",
				trackerIntake: { enabled: true, provider: "github", assignee: "octocat" },
			}),
		).toEqual({
			worker: { agent: "pi" },
			orchestrator: { agent: "pi" },
			trackerIntake: { enabled: true, provider: "github", assignee: "octocat" },
		});
	});
});
