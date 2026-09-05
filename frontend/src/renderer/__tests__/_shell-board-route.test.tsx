import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pins the /board route wiring: the sidebar's Kanban entry navigates here and
// the route renders the unscoped board (every project's kanban, not one
// project's). Board rendering itself is covered by SessionsBoard's tests.
const sessionsBoardMock = vi.hoisted(() => ({
	rendered: false,
	props: undefined as undefined | { projectId?: string },
}));

vi.mock("../components/SessionsBoard", () => ({
	SessionsBoard: (props: { projectId?: string }) => {
		sessionsBoardMock.rendered = true;
		sessionsBoardMock.props = props;
		return <div data-testid="sessions-board" />;
	},
}));

import { GlobalBoardRoute, Route } from "../routes/_shell.board";

describe("global board route", () => {
	it("wires the route component to the unscoped board", () => {
		expect(Route.options.component).toBe(GlobalBoardRoute);
	});

	it("renders the board without a project scope", () => {
		render(<GlobalBoardRoute />);

		expect(screen.getByTestId("sessions-board")).toBeInTheDocument();
		expect(sessionsBoardMock.props?.projectId).toBeUndefined();
	});
});
