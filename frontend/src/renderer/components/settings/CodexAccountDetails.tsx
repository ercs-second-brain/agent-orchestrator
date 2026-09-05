import { CircleAlert, LoaderCircle, RotateCcw } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { CodexAccount } from "../../hooks/useCodexAccountsQuery";
import { codexAccountReasonKey } from "../../hooks/codex-accounts-state";
import { Button } from "../ui/button";

export function CodexAccountDetails({ account, resetCreditSupported, mutationDisabled, resetBusy, onUseReset }: { account: CodexAccount; resetCreditSupported: boolean; mutationDisabled: boolean; resetBusy: boolean; onUseReset: () => void }) {
	const { i18n } = useTranslation();
	const plan = formatPlanLabel(account.capacity.plan, t);
	const hasOverall = Boolean(account.capacity.overall?.primary || account.capacity.overall?.secondary);
	const additionalBuckets = account.capacity.additionalBuckets.filter((bucket) => bucket.primary || bucket.secondary);
	const usage = account.usageSummary;
	const hasUsage = Boolean(usage && (usage.lifetimeTokens != null || usage.peakDailyTokens != null || usage.longestRunningTurnSeconds != null || usage.currentStreakDays != null || usage.longestStreakDays != null));
	const resetCredits = account.capacity.resetCredits;
	const hasDetails = Boolean(plan || hasOverall || additionalBuckets.length > 0 || hasUsage || resetCredits);
	const capacityNotice = capacityNoticeFor(account, t, i18n.language);
	return (
		<div className="ml-9 mt-4 space-y-5 pb-1 text-xs">
			{capacityNotice ? <CapacityNotice {...capacityNotice} /> : null}
			{plan || resetCredits ? <PlanCard plan={plan} resetCredits={resetCredits} resetEnabled={resetCreditSupported && !mutationDisabled} resetBusy={resetBusy} locale={i18n.language} onUseReset={onUseReset} /> : null}
			{hasUsage ? <AccountActivity usage={usage} locale={i18n.language} /> : null}
			{hasOverall && account.capacity.overall ? <CapacityBucketGroup bucket={account.capacity.overall} title={"General usage limits"} locale={i18n.language} /> : null}
			{additionalBuckets.map((bucket, index) => (
				<CapacityBucketGroup key={`${bucket.displayName ?? "additional"}-${index}`} bucket={bucket} title={bucket.displayName ? `${bucket.displayName} usage limits` : "Additional usage limits"} locale={i18n.language} />
			))}
			{!hasDetails && !capacityNotice ? <p className="text-muted-foreground">{"Usage details are not available for this account."}</p> : null}
		</div>
	);
}

type CapacityBucketValue = NonNullable<CodexAccount["capacity"]["overall"]>;
type CapacityWindowValue = NonNullable<CapacityBucketValue["primary"]>;
type UsageSummaryValue = NonNullable<CodexAccount["usageSummary"]>;
type ResetCreditsValue = NonNullable<CodexAccount["capacity"]["resetCredits"]>;

function CapacityBucketGroup({ bucket, title, locale }: { bucket: CapacityBucketValue; title: string; locale: string }) {
	const windows = [bucket.primary, bucket.secondary].filter((window): window is CapacityWindowValue => Boolean(window));
	return <section><h4 className="mb-2 font-medium text-foreground">{title}</h4><div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70 bg-muted/15">{windows.map((window, index) => <CapacityWindowRow key={`${index}-${window.windowDurationMinutes ?? "unknown"}-${window.resetsAt ?? "never"}`} window={window} label={capacityWindowLabel(window.windowDurationMinutes, index, windows.length, t)} reached={bucket.reached === "reached"} locale={locale} />)}</div></section>;
}

function CapacityWindowRow({ window, label, reached, locale }: { window: CapacityWindowValue; label: string; reached: boolean; locale: string }) {
	const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
	const percentage = formatPercentage(remaining, locale);
	const reset = formatResetTime(window.resetsAt, locale);
	const tone = reached || remaining <= 0 ? "exhausted" : remaining <= 25 ? "near" : "available";
	const fillClass = tone === "exhausted" ? "bg-error" : tone === "near" ? "bg-warning" : "bg-foreground/80";
	const valueClass = tone === "exhausted" ? "text-error" : tone === "near" ? "text-warning" : "text-muted-foreground";
	return <div className="grid gap-2 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,11rem)_auto] sm:items-center sm:gap-4"><div className="min-w-0"><p className="font-medium text-foreground">{label}</p>{reset ? <p className="mt-0.5 text-muted-foreground" title={reset.full}>{`Resets ${reset.visible}`}</p> : null}</div><div role="progressbar" aria-label={`${label}, ${percentage} left`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining} className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-[width] ${fillClass}`} style={{ width: `${remaining}%` }} /></div><p className={`whitespace-nowrap text-right tabular-nums ${valueClass}`}>{`${percentage} left`}</p></div>;
}

function PlanCard({ plan, resetCredits, resetEnabled, resetBusy, locale, onUseReset }: { plan: string | null; resetCredits: ResetCreditsValue | null | undefined; resetEnabled: boolean; resetBusy: boolean; locale: string; onUseReset: () => void }) {
	const expiry = formatResetTime(resetCredits?.nearestExpiresAt, locale);
	return <section aria-labelledby="codex-account-plan-heading"><h4 id="codex-account-plan-heading" className="mb-2 font-medium text-foreground">{"Your plan"}</h4><div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/70 bg-muted/15 px-3.5 py-3">{plan ? <p className="text-sm font-medium text-foreground">{plan}</p> : <span />}{resetCredits ? <div className="flex items-center gap-3"><div className="text-right"><p className="font-medium text-foreground">{resetCredits.availableCount > 0 ? (resetCredits.availableCount) === 1 ? `${resetCredits.availableCount} reset available` : `${resetCredits.availableCount} resets available` : "No resets available"}</p>{expiry ? <p className="mt-0.5 text-muted-foreground" title={expiry.full}>{`Expires ${expiry.visible}`}</p> : null}</div>{resetCredits.availableCount > 0 && resetEnabled ? <Button type="button" size="sm" variant="outline" disabled={resetBusy} onClick={onUseReset}>{resetBusy ? <LoaderCircle className="animate-spin" aria-label={"Resetting usage limits"} /> : <RotateCcw aria-hidden="true" />}{"Use reset"}</Button> : null}</div> : null}</div></section>;
}

function AccountActivity({ usage, locale }: { usage: UsageSummaryValue | null | undefined; locale: string }) {
	const metrics = [
		usage?.lifetimeTokens == null ? null : { label: "Lifetime tokens", value: `${formatCompactNumber(usage.lifetimeTokens, locale)} tokens` },
		usage?.peakDailyTokens == null ? null : { label: "Peak daily tokens", value: `${formatCompactNumber(usage.peakDailyTokens, locale)} tokens` },
		usage?.longestRunningTurnSeconds == null ? null : { label: "Longest chat", value: formatDuration(usage.longestRunningTurnSeconds, locale) },
		usage?.currentStreakDays == null ? null : { label: "Current streak", value: (usage.currentStreakDays) === 1 ? `${usage.currentStreakDays} day` : `${usage.currentStreakDays} days` },
		usage?.longestStreakDays == null ? null : { label: "Longest streak", value: (usage.longestStreakDays) === 1 ? `${usage.longestStreakDays} day` : `${usage.longestStreakDays} days` },
	].filter((metric): metric is { label: string; value: string } => Boolean(metric));
	if (metrics.length === 0) return null;
	return <section aria-labelledby="codex-account-activity-heading"><h4 id="codex-account-activity-heading" className="mb-2 font-medium text-foreground">{"Activity"}</h4><div className="rounded-md border border-border/70 bg-muted/15"><div data-testid="codex-account-activity-metrics" className="grid divide-x divide-border/70" style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}>{metrics.map((metric) => <div key={metric.label} className="min-w-0 px-2 py-2.5 text-center"><p className="truncate text-[13px] font-semibold leading-5 tabular-nums text-foreground" title={metric.value}>{metric.value}</p><p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{metric.label}</p></div>)}</div></div></section>;
}

function CapacityNotice({ reason, tone, checking }: { reason: string; tone: "warning" | "error" | "muted"; checking?: boolean }) {
	const color = tone === "error" ? "border-error/30 bg-error/8 text-error" : tone === "warning" ? "border-warning/30 bg-warning/10 text-warning" : "border-border bg-muted/20 text-muted-foreground";
	return <p className={`flex items-start gap-2 rounded-md border px-3 py-2.5 leading-5 ${color}`} role={tone === "error" ? "alert" : "status"}>{checking ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-label={"Checking"} /> : <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}<span>{reason}</span></p>;
}

function capacityNoticeFor(account: CodexAccount, t: TFunction, locale: string): { reason: string; tone: "warning" | "error" | "muted"; checking?: boolean } | null {
	if (account.status === "broken") return { reason: t(codexAccountReasonKey(account.reasonCode)), tone: "error" };
	if (account.authentication.state === "unauthorized") return { reason: t(codexAccountReasonKey(account.authentication.reasonCode)), tone: "warning" };
	if (account.capacity.freshness === "checking") return { reason: t(codexAccountReasonKey(account.capacity.reasonCode)), tone: "muted", checking: true };
	if (account.capacity.freshness === "stale") {
		const checked = account.capacity.checkedAt ? formatObservedTime(account.capacity.checkedAt, locale) : null;
		return { reason: checked ? `Usage information may be out of date. Last checked ${checked}.` : "Usage information may be out of date.", tone: "warning" };
	}
	if (account.capacity.state === "unknown" || account.capacity.state === "unsupported") return { reason: t(codexAccountReasonKey(account.capacity.reasonCode)), tone: "muted" };
	return null;
}

function capacityWindowLabel(minutes: number | null | undefined, index: number, count: number, t: TFunction): string {
	if (minutes === 300) return "5-hour usage limit";
	if (minutes === 10080) return "Weekly usage limit";
	if (minutes && minutes > 0 && minutes % 1440 === 0) return (minutes / 1440) === 1 ? `${minutes / 1440}-day usage limit` : `${minutes / 1440}-day usage limit`;
	if (minutes && minutes > 0 && minutes % 60 === 0) return (minutes / 60) === 1 ? `${minutes / 60}-hour usage limit` : `${minutes / 60}-hour usage limit`;
	if (minutes && minutes > 0) return (minutes) === 1 ? `${minutes}-minute usage limit` : `${minutes}-minute usage limit`;
	if (count === 1) return "Usage limit";
	return index === 0 ? "Primary usage limit" : "Secondary usage limit";
}

export function formatAuthMethod(method: CodexAccount["authMethod"]): string | null { return method === "chatgpt" ? "ChatGPT" : method === "api_key" ? "API key" : method === "other" ? "Codex" : null; }
export function formatPlanName(plan: string | null | undefined): string | null { const value = plan?.trim(); if (!value) return null; const known: Record<string, string> = { free: "Free", plus: "Plus", pro: "Pro", team: "Team", business: "Business", enterprise: "Enterprise" }; return known[value.toLowerCase()] ?? value; }
function formatPlanLabel(plan: string | null | undefined, t: TFunction): string | null { const name = formatPlanName(plan); return name ? (/\bplan$/i.test(name) ? name : `${name} plan`) : null; }
export function formatPercentage(value: number, locale?: string): string { return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`; }
function formatResetTime(value: string | null | undefined, locale: string): { visible: string; full: string } | null { if (!value) return null; const date = new Date(value); if (Number.isNaN(date.getTime())) return null; const now = new Date(); const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate(); return { visible: new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date), full: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long" }).format(date) }; }
function formatObservedTime(value: string, locale: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatCompactNumber(value: number, locale: string): string { return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatDuration(totalSeconds: number, locale: string): string { const seconds = Math.max(0, Math.round(totalSeconds)); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; const number = new Intl.NumberFormat(locale); return hours > 0 ? `${number.format(hours)}h ${number.format(minutes)}m` : minutes > 0 ? `${number.format(minutes)}m` : `${number.format(remainder)}s`; }
