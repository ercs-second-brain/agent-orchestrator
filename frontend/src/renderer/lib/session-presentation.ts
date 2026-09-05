import {
	attentionZone,
	attentionZoneOrder,
	boardAttentionZoneOrder,
	boardKanbanColumnOrder,
	getAgentActivityView as getPortableAgentActivityView,
	getAttentionZoneView as getPortableAttentionZoneView,
	getAttentionZoneViewForZone as getPortableAttentionZoneViewForZone,
	getKanbanColumnView as getPortableKanbanColumnView,
	getSessionStatusView as getPortableSessionStatusView,
	getSessionTimelinePillView as getPortableSessionTimelinePillView,
	isAgentActivityWorking,
	isSessionIdle,
	type AgentActivityView,
	type AttentionZone,
	type AttentionZoneView,
	type KanbanColumn,
	type KanbanColumnView,
	type SessionStatusView,
	type SessionTimelinePillStatus,
	type SessionTimelinePillView,
} from "@ercs-second-brain/product-ui";
import type { SessionActivity, SessionStatus } from "../types/workspace";

export function getAgentActivityView(activity?: SessionActivity | null): AgentActivityView {
	return getPortableAgentActivityView(activity);
}

export function getSessionStatusView(status: SessionStatus): SessionStatusView {
	return getPortableSessionStatusView(status);
}

export function getAttentionZoneView(status: SessionStatus): AttentionZoneView {
	return getPortableAttentionZoneView(status);
}

export function getAttentionZoneViewForZone(zone: AttentionZone): AttentionZoneView {
	return getPortableAttentionZoneViewForZone(zone);
}

export type SessionStatusDotView = {
	className: string;
	breathe: boolean;
};

// The session dot carries two independent signals. Colour comes from the board
// section represented by the SCM state, which survives a running agent —
// `status` is activity-first, so it collapses to `working` the moment an agent
// wakes and would otherwise take every pull request tone with it. Merged keeps
// its split-section tone instead of sharing Ready to merge's tone.
//
// Motion stays on raw agent activity. A no-PR idle session is the exception to
// the preserved section colour: when its agent starts working it blinks blue.
export function getSessionStatusDotView(session: {
	activity?: SessionActivity | null;
	scmStatus?: SessionStatus;
	status: SessionStatus;
}): SessionStatusDotView {
	const working = isAgentActivityWorking(session.activity);
	const sectionStatus = session.scmStatus ?? session.status;
	const toneStatus = sectionStatus === "idle" && working ? "working" : sectionStatus;
	const className =
		toneStatus === "idle" || toneStatus === "merged"
			? getSessionStatusView(toneStatus).dotClassName
			: getAttentionZoneView(toneStatus).dotClassName;

	return {
		className,
		breathe: working,
	};
}

export function getKanbanColumnView(column: KanbanColumn): KanbanColumnView {
	return getPortableKanbanColumnView(column);
}

export function getSessionTimelinePillView(status: SessionTimelinePillStatus): SessionTimelinePillView {
	return getPortableSessionTimelinePillView(status);
}

export const attentionZoneLabel: Record<AttentionZone, string> = {
	get merge() {
		return getAttentionZoneViewForZone("merge").label;
	},
	get action() {
		return getAttentionZoneViewForZone("action").label;
	},
	get pending() {
		return getAttentionZoneViewForZone("pending").label;
	},
	get working() {
		return getAttentionZoneViewForZone("working").label;
	},
	get done() {
		return getAttentionZoneViewForZone("done").label;
	},
};

export {
	attentionZone,
	attentionZoneOrder,
	boardAttentionZoneOrder,
	boardKanbanColumnOrder,
	isAgentActivityWorking,
	isSessionIdle,
};
export type {
	AgentActivityView,
	AttentionZone,
	AttentionZoneView,
	KanbanColumnView,
	SessionStatusView,
	SessionTimelinePillStatus,
	SessionTimelinePillView,
};
