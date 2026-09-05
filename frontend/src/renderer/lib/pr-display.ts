import type { SessionPRSummary } from "../hooks/useSessionScmSummary";
import { sortedPRs, type PRState, type PullRequestFacts, type WorkspaceSession } from "../types/workspace";
import type {
	PRCardPresentation,
	PRCardStatus,
	PRDisplayTone,
	PRNoun,
	PRStatusRow,
	PRSummaryLink,
	PRSummaryPart,
} from "@ercs-second-brain/product-ui";

export type {
	PRCardPresentation,
	PRCardStatus,
	PRDisplayTone,
	PRNoun,
	PRSummaryLink,
	PRSummaryPart,
	PRSummaryPartKey,
} from "@ercs-second-brain/product-ui";

function detectProviderFromUrl(url: string): "github" | "gitlab" {
	if (url.includes("/-/merge_requests/")) return "gitlab";
	return "github";
}

const prStateRank: Record<PRState, number> = { open: 0, draft: 1, merged: 2, closed: 3 };
const ciStates = new Set<SessionPRSummary["ci"]["state"]>(["unknown", "pending", "passing", "failing"]);
const reviewDecisions = new Set<SessionPRSummary["review"]["decision"]>([
	"none",
	"approved",
	"changes_requested",
	"review_required",
]);
const mergeabilityStates = new Set<SessionPRSummary["mergeability"]["state"]>([
	"unknown",
	"mergeable",
	"conflicting",
	"blocked",
	"unstable",
]);

export const prNouns: Record<PRNoun, { one: string; other: string }> = {
	check: { one: "check", other: "checks" },
	comment: { one: "comment", other: "comments" },
	file: { one: "file", other: "files" },
	line: { one: "line", other: "lines" },
	reason: { one: "reason", other: "reasons" },
	reviewer: { one: "reviewer", other: "reviewers" },
};

export function comparePRDisplaySummaries(a: SessionPRSummary, b: SessionPRSummary): number {
	return prStateRank[a.state] - prStateRank[b.state] || a.number - b.number;
}

export function prBrowserUrl(pr: SessionPRSummary): string {
	return prBaseUrl(pr) ?? pr.htmlUrl ?? pr.url;
}

export function prChecksUrl(pr: SessionPRSummary): string | undefined {
	try {
		const url = new URL(prBrowserUrl(pr));
		if (url.hostname.toLowerCase() !== "github.com" || !/\/pull\/\d+\/?$/.test(url.pathname)) return undefined;
		return `${url.origin}${url.pathname.replace(/\/$/, "")}/checks`;
	} catch {
		return undefined;
	}
}

/**
 * Canonical identity key for deduplication. Reuses the URL normalization
 * from `prURL` (which normalizes GitHub issues→pull, strips query/fragment,
 * and handles GitLab MR paths). When the URL is absent or unrecognized
 * (e.g. API URLs), falls back to `number:${number}` so the enriched summary
 * still matches the session fact.
 */
function canonicalKey(url: string, number: number): string {
	return canonicalURL(url) || `number:${number}`;
}

function canonicalURL(rawUrl: string): string | undefined {
	return prURL({ url: rawUrl, htmlUrl: rawUrl, mergeability: { prUrl: rawUrl } } as SessionPRSummary);
}

export function sessionPRDisplaySummaries(
	session: WorkspaceSession,
	summaries: SessionPRSummary[] = [],
): SessionPRSummary[] {
	// Key by canonical web URL so a GitHub PR #7 and a GitLab MR #7 (or any
	// same-numbered PRs across providers/repos) both appear instead of one
	// hiding the other. The key normalizes known URL shapes (e.g. GitHub
	// issues/7 → pull/7, query params/fragments stripped) so the same PR
	// observed under different URL variants collapses to one card.
	// Non-standard URLs (API URLs, etc.) fall back to `number:${number}` so
	// the enriched summary still matches the session fact.
	const summariesByUrl = new Map<string, SessionPRSummary>();
	for (const s of summaries) {
		const key = canonicalKey(s.url, s.number);
		if (!summariesByUrl.has(key)) summariesByUrl.set(key, s);
	}
	const seen = new Set<string>();
	const fromFactsMap = new Map<string, SessionPRSummary>();
	for (const pr of sortedPRs(session)) {
		const key = canonicalKey(pr.url, pr.number);
		seen.add(key);
		if (!fromFactsMap.has(key)) {
			fromFactsMap.set(key, summariesByUrl.get(key) ?? sessionPRFactToSummary(session, pr));
		}
	}
	const summaryOnly = [...summariesByUrl.values()].filter((s) => !seen.has(canonicalKey(s.url, s.number)));
	return [...fromFactsMap.values(), ...summaryOnly].sort(comparePRDisplaySummaries);
}

function sessionPRFactToSummary(session: WorkspaceSession, pr: PullRequestFacts): SessionPRSummary {
	return {
		url: pr.url,
		htmlUrl: pr.url,
		number: pr.number,
		title: session.title,
		state: pr.state,
		provider: detectProviderFromUrl(pr.url),
		repo: session.workspaceName,
		author: "",
		sourceBranch: session.branch ?? "",
		targetBranch: "",
		headSha: "",
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		ci: {
			autoInjectCI: true,
			state: toCIState(pr.ci),
			failingChecks: [],
		},
		review: {
			decision: toReviewDecision(pr.review),
			hasUnresolvedHumanComments: pr.reviewComments,
			unresolvedBy: [],
		},
		mergeability: {
			state: toMergeabilityState(pr.mergeability),
			reasons: [],
			prUrl: pr.url,
			conflictFiles: [],
		},
		updatedAt: pr.updatedAt,
		observedAt: pr.updatedAt,
		ciObservedAt: pr.updatedAt,
		reviewObservedAt: pr.updatedAt,
	};
}

export function prStatusRows(pr: SessionPRSummary): PRStatusRow[] {
	return prSummaryParts(pr).map((part) => ({
		key: part.key,
		label: part.label,
		value: part.status,
		detail: part.key === "merge" ? formatDiffSummary(pr) : undefined,
		tone: part.tone,
	}));
}

/**
 * Reduces provider facts to one next-action headline for compact PR cards.
 * The detailed three-row presentation remains available for dense reports,
 * but cards should not repeat the same blocker under Merge and Review.
 */
export function prCardPresentation(pr: SessionPRSummary): PRCardPresentation {
	let primary: PRCardStatus;
	if (pr.state === "merged") {
		primary = cardStatus("lifecycle", "Pull request merged", "success");
	} else if (pr.state === "closed") {
		primary = cardStatus("lifecycle", "Pull request closed", "passive");
	} else if (pr.ci.state === "failing") {
		primary = cardStatus("ci", "Checks failing", "error", ciSummary(pr), ciLinks(pr));
	} else if (pr.mergeability.state === "conflicting") {
		primary = cardStatus("merge", "Merge conflict", "error", mergeSummary(pr), mergeLinks(pr));
	} else if (pr.review.decision === "changes_requested" || pr.review.hasUnresolvedHumanComments) {
		primary = cardStatus("review", "Changes requested", "warning", reviewSummary(pr), reviewLinks(pr));
	} else if (pr.review.decision === "review_required") {
		primary = cardStatus("review", "pr.card.reviewRequired", "review", "Merge blocked until a required review is submitted.");
	} else if (pr.ci.state === "pending") {
		primary = cardStatus("ci", "Checks running", "neutral", undefined, [], prChecksUrl(pr), true);
	} else if (pr.ci.state === "unknown") {
		primary = cardStatus("ci", "Checking merge readiness", "passive", undefined, [], prChecksUrl(pr), true);
	} else if (pr.mergeability.state === "blocked" || pr.mergeability.state === "unstable") {
		primary = cardStatus(
			"merge",
			visibleMergeReasons(pr).length === 0 ? "Merge unavailable" : "Merge blocked",
			"warning",
			mergeSummary(pr),
			mergeLinks(pr),
		);
	} else if (pr.state === "draft") {
		primary = cardStatus("lifecycle", "Draft pull request", "neutral");
	} else if (pr.mergeability.state === "mergeable") {
		primary = cardStatus("merge", "Ready to merge", "success");
	} else if (pr.review.decision === "approved") {
		primary = cardStatus("review", "Review approved", "success");
	} else {
		primary = cardStatus("lifecycle", "Pull request open", "neutral");
	}

	const supporting: PRCardStatus[] = [];
	if (pr.state === "open" && primary.key !== "ci") {
		if (pr.ci.state === "passing") {
			supporting.push(cardStatus("ci", "Checks passing", "success", undefined, [], prChecksUrl(pr)));
		} else if (pr.ci.state === "pending") {
			supporting.push(cardStatus("ci", "Checks running", "neutral", undefined, [], prChecksUrl(pr), true));
		} else if (pr.ci.state === "unknown") {
			supporting.push(cardStatus("ci", "Checking merge readiness", "passive", undefined, [], prChecksUrl(pr), true));
		}
	}
	if (pr.state === "open") {
		const statusRows: PRCardStatus[] = [];
		if (pr.mergeability.state === "conflicting") {
			statusRows.push(cardStatus("merge", "Merge conflict", "error", "Resolve before merging", mergeLinks(pr)));
		}
		if (pr.ci.state === "passing") {
			statusRows.push(cardStatus("ci", "Checks passing", "success", undefined, [], prChecksUrl(pr)));
		} else if (pr.ci.state === "failing") {
			statusRows.push(cardStatus("ci", "Checks failing", "error", undefined, [], prChecksUrl(pr)));
		} else if (pr.ci.state === "pending" || pr.ci.state === "unknown") {
			statusRows.push(cardStatus("ci", pr.ci.state === "pending" ? "Checks running" : "Checking merge readiness", "neutral", undefined, [], prChecksUrl(pr), true));
		}
		statusRows.push(cardStatus("review", "Review status", reviewTone(pr.review.decision, pr.review.hasUnresolvedHumanComments), reviewStatusDetail(pr)));
		const mergeable = pr.mergeability.state !== "conflicting" && pr.ci.state === "passing" && pr.review.decision === "approved";
		const checkingReadiness = pr.ci.state === "pending" || pr.ci.state === "unknown" || pr.mergeability.state === "unknown";
		return { primary, supporting, statusRows, readiness: {
			label: checkingReadiness ? "Checking merge readiness" : mergeable ? "Mergeable" : "Not mergeable yet",
			detail: checkingReadiness ? "Waiting for the latest checks and review state." : mergeReadinessDetail(pr),
			tone: checkingReadiness ? "neutral" : mergeable ? "success" : "error",
		} };
	}
	return { primary, supporting };
}

function cardStatus(
	key: PRCardStatus["key"],
	label:
		| "Pull request merged"
		| "Pull request closed"
		| "Checks failing"
		| "Merge conflict"
		| "Changes requested"
		| "Review required"
		| "Merge blocked"
		| "Merge unavailable"
		| "Checks running"
		| "Checking merge readiness"
		| "Draft pull request"
		| "Ready to merge"
		| "Review approved"
		| "Pull request open"
		| "Checks passing"
		| "Review status",
	tone: PRDisplayTone,
	detail?: string,
	links: PRSummaryLink[] = [],
	href?: string,
	breathe = false,
): PRCardStatus {
	return { key, label, detail, href, breathe, links, tone };
}

function reviewStatusDetail(pr: SessionPRSummary): string {
	switch (pr.review.decision) {
		case "approved": return "PR approved";
		case "changes_requested": return "Changes requested";
		case "review_required": return "Required review not submitted";
		default: return "Review pending";
	}
}

function mergeReadinessDetail(pr: SessionPRSummary): string {
	if (pr.mergeability.state === "conflicting") return "One approval is sufficient, but the merge conflict still blocks this PR.";
	if (pr.ci.state === "failing") return "The review requirement is satisfied, but failing checks still block this PR.";
	if (pr.review.decision !== "approved") return "A required review must be completed before this PR can merge.";
	return "No merge conflict, checks are passing, and the review requirement is satisfied.";
}

export function prSummaryParts(pr: SessionPRSummary): PRSummaryPart[] {
	return [
		{
			key: "ci",
			label: "CI",
			status: ciLabel(pr.ci.state),
			summary: ciSummary(pr),
			links: ciLinks(pr),
			linkTotal: pr.ci.state === "failing" ? pr.ci.failingChecks.length : 0,
			overflowLabel: pr.ci.state === "failing" ? overflowLabel(pr.ci.failingChecks.length, 3, "check") : undefined,
			overflowNoun: "check",
			tone: ciTone(pr.ci.state),
		},
		{
			key: "merge",
			label: "Merge",
			status: mergeabilityLabel(pr.mergeability.state),
			summary: mergeSummary(pr),
			links: mergeLinks(pr),
			linkTotal: mergeLinkTotal(pr),
			overflowLabel: mergeOverflowLabel(pr),
			overflowNoun: mergeOverflowNoun(pr),
			tone: mergeabilityTone(pr.mergeability.state),
		},
		{
			key: "review",
			label: "Review",
			status: reviewLabel(pr.review.decision),
			summary: reviewSummary(pr),
			links: reviewLinks(pr),
			linkTotal: reviewLinkTotal(pr),
			overflowLabel:
				pr.state === "draft" || pr.review.decision === "review_required"
					? undefined
					: overflowLabel(pr.review.unresolvedBy.length, 3, "reviewer"),
			overflowNoun: "reviewer",
			tone: reviewTone(pr.review.decision, pr.review.hasUnresolvedHumanComments),
		},
	];
}

export function prDiffSummary(pr: SessionPRSummary): string | undefined {
	const parts: string[] = [];
	if (pr.changedFiles > 0) {
		parts.push(`${pr.changedFiles} ${pluralize("file", pr.changedFiles)}`);
	}
	const lineDelta = formatLineDelta(pr.additions, pr.deletions);
	if (lineDelta) {
		parts.push(lineDelta);
	}
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function ciSummary(pr: SessionPRSummary): string | undefined {
	if (pr.ci.state === "failing") {
		return pr.ci.failingChecks.length === 0 ? "No failing check link observed" : undefined;
	}
	return undefined;
}

function ciLinks(pr: SessionPRSummary): PRSummaryLink[] {
	if (pr.ci.state !== "failing") {
		return [];
	}
	return pr.ci.failingChecks.slice(0, 3).map((check) => ({
		label: check.name,
		href: check.url || undefined,
		title: check.conclusion || check.status,
	}));
}

function reviewSummary(pr: SessionPRSummary): string | undefined {
	if (pr.state === "merged" || pr.state === "closed") {
		return undefined;
	}
	if (pr.state === "draft") {
		return "Draft PR · Not ready for review";
	}
	if (pr.review.decision === "changes_requested" || pr.review.hasUnresolvedHumanComments) {
		return reviewLinks(pr).length === 0 ? "Changes requested" : undefined;
	}
	if (pr.review.decision === "review_required") {
		return "Required review not submitted";
	}
	return undefined;
}

function reviewLinks(pr: SessionPRSummary): PRSummaryLink[] {
	if (pr.state === "merged" || pr.state === "closed" || pr.state === "draft") {
		return [];
	}
	if (pr.review.decision !== "changes_requested" && !pr.review.hasUnresolvedHumanComments) {
		return [];
	}
	const links = pr.review.unresolvedBy.slice(0, 3).map((reviewer) => reviewAttentionLink(pr, reviewer));
	if (links.length === 0 && pr.review.decision === "changes_requested") {
		links.push({
			label: "PR",
			href: prBrowserUrl(pr),
			title: "Open pull request",
		});
	}
	return links;
}

function mergeSummary(pr: SessionPRSummary): string | undefined {
	if (pr.state === "merged" || pr.state === "closed") {
		return formatDiffSummary(pr);
	}
	if (pr.mergeability.state === "conflicting") {
		return mergeLinks(pr).length === 0 ? "Conflicts with the base branch" : undefined;
	}
	if (pr.mergeability.state === "blocked" || pr.mergeability.state === "unstable") {
		return mergeLinks(pr).length === 0 ? "GitHub currently reports this pull request can't be merged." : undefined;
	}
	return formatDiffSummary(pr);
}

function mergeLinks(pr: SessionPRSummary): PRSummaryLink[] {
	if (pr.state === "merged" || pr.state === "closed") {
		return [];
	}
	if (pr.mergeability.state === "conflicting") {
		return mergeAttentionLinks(pr, "merge_conflict");
	}
	if (pr.mergeability.state === "blocked" || pr.mergeability.state === "unstable") {
		return mergeAttentionLinks(pr, "merge_blocked");
	}
	return [];
}

function mergeOverflowLabel(pr: SessionPRSummary): string | undefined {
	if (pr.state === "merged" || pr.state === "closed") {
		return undefined;
	}
	const hasFileLinks = (pr.mergeability.conflictFiles ?? []).length > 0;
	if (hasFileLinks) {
		return overflowLabel(pr.mergeability.conflictFiles?.length ?? 0, 3, "file");
	}
	if (pr.mergeability.state === "blocked" || pr.mergeability.state === "unstable") {
		return overflowLabel(visibleMergeReasons(pr).length, 3, "reason");
	}
	return undefined;
}

function mergeLinkTotal(pr: SessionPRSummary): number {
	if (pr.state === "merged" || pr.state === "closed") {
		return 0;
	}
	if (pr.mergeability.state === "conflicting") {
		const conflictFileCount = pr.mergeability.conflictFiles?.length ?? 0;
		return conflictFileCount > 0 ? conflictFileCount : mergeLinks(pr).length;
	}
	if (pr.mergeability.state === "blocked" || pr.mergeability.state === "unstable") {
		return visibleMergeReasons(pr).length;
	}
	return 0;
}

function mergeOverflowNoun(pr: SessionPRSummary): PRNoun {
	return (pr.mergeability.conflictFiles ?? []).length > 0 ? "file" : "reason";
}

function reviewLinkTotal(pr: SessionPRSummary): number {
	if (pr.state === "merged" || pr.state === "closed" || pr.state === "draft") {
		return 0;
	}
	if (pr.review.decision !== "changes_requested" && !pr.review.hasUnresolvedHumanComments) {
		return 0;
	}
	return pr.review.unresolvedBy.length > 0 ? pr.review.unresolvedBy.length : reviewLinks(pr).length;
}

function toCIState(value: string): SessionPRSummary["ci"]["state"] {
	return ciStates.has(value as SessionPRSummary["ci"]["state"])
		? (value as SessionPRSummary["ci"]["state"])
		: "unknown";
}

function toReviewDecision(value: string): SessionPRSummary["review"]["decision"] {
	return reviewDecisions.has(value as SessionPRSummary["review"]["decision"])
		? (value as SessionPRSummary["review"]["decision"])
		: "none";
}

function toMergeabilityState(value: string): SessionPRSummary["mergeability"]["state"] {
	return mergeabilityStates.has(value as SessionPRSummary["mergeability"]["state"])
		? (value as SessionPRSummary["mergeability"]["state"])
		: "unknown";
}

function ciLabel(state: SessionPRSummary["ci"]["state"]): string {
	switch (state) {
		case "passing":
			return "Passing";
		case "failing":
			return "Failing";
		case "pending":
			return "Pending";
		case "unknown":
			return "Checking";
	}
}

function ciTone(state: SessionPRSummary["ci"]["state"]): PRDisplayTone {
	switch (state) {
		case "passing":
			return "success";
		case "failing":
			return "error";
		case "pending":
			return "neutral";
		case "unknown":
			return "passive";
	}
}

function reviewLabel(decision: SessionPRSummary["review"]["decision"]): string {
	switch (decision) {
		case "approved":
			return "Approved";
		case "changes_requested":
			return "Changes requested";
		case "review_required":
			return "Review pending";
		case "none":
			return "None";
	}
}

function reviewTone(
	decision: SessionPRSummary["review"]["decision"],
	hasUnresolvedHumanComments: boolean,
): PRDisplayTone {
	switch (decision) {
		case "approved":
			return "success";
		case "changes_requested":
			return "warning";
		case "review_required":
			return "review";
		case "none":
			return hasUnresolvedHumanComments ? "warning" : "passive";
	}
}

function mergeabilityLabel(state: SessionPRSummary["mergeability"]["state"]): string {
	switch (state) {
		case "mergeable":
			return "Mergeable";
		case "conflicting":
			return "Conflict";
		case "blocked":
			return "Blocked";
		case "unstable":
			return "Unstable";
		case "unknown":
			return "Checking";
	}
}

function mergeabilityTone(state: SessionPRSummary["mergeability"]["state"]): PRDisplayTone {
	switch (state) {
		case "mergeable":
			return "success";
		case "conflicting":
			return "error";
		case "blocked":
		case "unstable":
			return "warning";
		case "unknown":
			return "passive";
	}
}

function formatDiffSummary(pr: SessionPRSummary): string | undefined {
	if (pr.changedFiles > 0) {
		return `${pr.changedFiles} ${pluralize("file", pr.changedFiles)}`;
	}
	const changedLines = pr.additions + pr.deletions;
	if (changedLines > 0) {
		return `${changedLines} ${pluralize("line", changedLines)}`;
	}
	return undefined;
}

function formatLineDelta(additions: number, deletions: number): string | undefined {
	const parts: string[] = [];
	if (additions > 0) {
		parts.push(`+${additions}`);
	}
	if (deletions > 0) {
		parts.push(`-${deletions}`);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}

function mergeAttentionLinks(pr: SessionPRSummary, kind: "merge_conflict" | "merge_blocked"): PRSummaryLink[] {
	const href =
		kind === "merge_conflict" ? mergeConflictUrl(pr) : pr.mergeability.prUrl || pr.htmlUrl || pr.url || undefined;
	const openConflicts = "Open merge conflicts";
	const fileLinks = (pr.mergeability.conflictFiles ?? []).slice(0, 3).map((file) => ({
		label: file.path,
		href: file.url || href,
		title: kind === "merge_conflict" ? openConflicts : undefined,
	}));
	const reasonLinks =
		fileLinks.length > 0 || kind === "merge_conflict"
			? []
			: visibleMergeReasons(pr).slice(0, 3).map((reason) => ({
					label: mergeReasonLabel(reason),
					href,
				}));
	const fallbackLink =
		kind === "merge_conflict" && href
			? [{ label: "conflicts", href, title: openConflicts }]
			: [];
	return fileLinks.length > 0 ? fileLinks : reasonLinks.length > 0 ? reasonLinks : fallbackLink;
}

// `blocked_by_provider` is an internal fallback for a host verdict AO cannot
// explain more precisely. It is not an actionable reason, so cards summarize
// it as merge availability instead of exposing implementation terminology.
function visibleMergeReasons(pr: SessionPRSummary): string[] {
	return pr.mergeability.reasons.filter((reason) => reason !== "blocked_by_provider");
}

function mergeConflictUrl(pr: SessionPRSummary): string | undefined {
	return prSubpageUrl(pr, "conflicts") ?? pr.mergeability.prUrl ?? prBrowserUrl(pr);
}

function prBaseUrl(pr: SessionPRSummary): string | undefined {
	return prURL(pr);
}

function prSubpageUrl(pr: SessionPRSummary, subpage: "conflicts"): string | undefined {
	const base = prURL(pr);
	return base ? `${base}/${subpage}` : undefined;
}

function prURL(pr: SessionPRSummary): string | undefined {
	const raw = pr.htmlUrl || pr.mergeability.prUrl || pr.url;
	if (!raw) {
		return undefined;
	}
	try {
		const url = new URL(raw);
		// GitHub: /owner/repo/pull/N or /issues/N
		const ghMatch = url.pathname.match(/^(\/[^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)(?:\/.*)?$/);
		if (ghMatch) {
			url.pathname = `${ghMatch[1]}/pull/${ghMatch[2]}`;
			url.search = "";
			url.hash = "";
			return url.toString();
		}
		// GitLab: /owner/repo/-/merge_requests/N
		const glMatch = url.pathname.match(/^(\/[^/]+\/[^/]+)\/-\/merge_requests\/(\d+)(?:\/.*)?$/);
		if (glMatch) {
			url.pathname = `${glMatch[1]}/-/merge_requests/${glMatch[2]}`;
			url.search = "";
			url.hash = "";
			return url.toString();
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function reviewerLabel(reviewer: SessionPRSummary["review"]["unresolvedBy"][number]): string {
	const name = reviewerDisplayName(reviewer);
	if (reviewer.count <= 1) {
		return name;
	}
	return `${name} +${reviewer.count - 1}`;
}

function reviewerDisplayName(reviewer: SessionPRSummary["review"]["unresolvedBy"][number]): string {
	if (!reviewer.isBot) return reviewer.reviewerId;
	return `${reviewer.reviewerId} bot`;
}

function reviewAttentionLink(
	pr: SessionPRSummary,
	reviewer: SessionPRSummary["review"]["unresolvedBy"][number],
): PRSummaryLink {
	const name = reviewerDisplayName(reviewer);
	const inlineURL = reviewer.links.find((link) => link.url)?.url;
	if (reviewer.reviewUrl) {
		return {
			label: reviewerLabel(reviewer),
			href: reviewer.reviewUrl,
			title: `Open requested-changes review from ${name}`,
		};
	}
	if (inlineURL) {
		return {
			label: reviewerLabel(reviewer),
			href: inlineURL,
				title:
					reviewer.count > 0
						? (reviewer.count) === 1 ? `${reviewer.count} unresolved comment from ${name}` : `${reviewer.count} unresolved comments from ${name}`
					: `Open review comments from ${name}`,
		};
	}
	return {
		label: reviewerLabel(reviewer),
		href: prBrowserUrl(pr),
		title: `Open pull request for ${name}`,
	};
}

function mergeReasonLabel(reason: string): string {
	switch (reason) {
		case "behind_base":
			return "branch behind base";
		case "ci_failing":
			return "CI failing";
		case "changes_requested":
			return "changes requested";
		case "review_required":
			return "review required";
		case "blocked_by_provider":
			return "merge unavailable";
		default:
			return reason.replaceAll("_", " ");
	}
}

function overflowLabel(total: number, shown: number, noun: PRNoun): string | undefined {
	const extra = total - shown;
	if (extra <= 0) {
		return undefined;
	}
	return `+${extra} ${pluralize(noun, extra)}`;
}

function pluralize(noun: PRNoun, count: number): string {
	return (count) === 1 ? prNouns[noun].one : prNouns[noun].other;
}
