import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentAvatar } from "./AgentAvatar";

describe("AgentAvatar", () => {
	it("renders the pi brand asset", () => {
		render(<AgentAvatar provider="pi" />);

		expect(screen.getByRole("img", { name: "pi" })).toHaveAttribute(
			"src",
			expect.stringContaining("pi.png"),
		);
	});

	it("falls back to a lettered tile for legacy provider names", () => {
		render(<AgentAvatar provider="codex" />);

		expect(screen.getByRole("img", { name: "codex" })).toHaveTextContent("C");
	});
});