import { createFileRoute } from "@tanstack/react-router";
import { SessionsBoard } from "../components/SessionsBoard";

export const Route = createFileRoute("/_shell/board")({
	component: GlobalBoardRoute,
});

// The sidebar's Kanban entry lands here: one board across every project,
// not scoped to a single workspace (SessionsBoard's global mode).
export function GlobalBoardRoute() {
	return <SessionsBoard />;
}
