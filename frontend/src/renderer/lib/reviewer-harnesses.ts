import type { components } from "../../api/schema";

// Reviewers are a narrower vocabulary than worker agents on purpose: a
// reviewer-only tool must not become a valid worker.
//
// The set itself comes from the daemon rather than being maintained here. The
// review trigger's request schema is generated from domain.AllReviewerHarnesses,
// so this union IS the server's list. Since ADR 0005 pi is the single supported
// harness, so the union has one member.
export type ReviewerHarnessId = NonNullable<components["schemas"]["TriggerReviewRequest"]["harness"]>;

const REVIEWER_HARNESS_IDS = ["pi"] as const satisfies readonly ReviewerHarnessId[];

type UnlistedReviewerHarness = Exclude<ReviewerHarnessId, (typeof REVIEWER_HARNESS_IDS)[number]>;
const _everyReviewerHarnessIsListed: UnlistedReviewerHarness extends never ? true : never = true;
void _everyReviewerHarnessIsListed;

export const KNOWN_REVIEWER_HARNESS_IDS: ReadonlySet<string> = new Set(REVIEWER_HARNESS_IDS);

export function toReviewerHarnessId(value?: string): ReviewerHarnessId | undefined {
	// Legacy harness names in historical session rows are kept but ignored;
	// they render as the supported reviewer vocabulary (or nothing).
	return value && KNOWN_REVIEWER_HARNESS_IDS.has(value) ? (value as ReviewerHarnessId) : undefined;
}