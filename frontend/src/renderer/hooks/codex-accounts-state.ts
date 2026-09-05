import type { QueryClient } from "@tanstack/react-query";
import type { CodexAccountSwitch, CodexAccountsResponse } from "./useCodexAccountsQuery";

export const codexAccountsQueryKey = ["codex-accounts"] as const;

export type AccountMergeMode = "replace" | "preserveMissing";

export function mergeCodexAccounts(
	current: CodexAccountsResponse | undefined,
	incoming: CodexAccountsResponse,
	mode: AccountMergeMode,
): CodexAccountsResponse {
	if (current && incoming.accountRevision < current.accountRevision) return current;
	const accounts = mode === "preserveMissing" && current
		? [...current.accounts.filter((account) => !incoming.accounts.some((next) => next.id === account.id)), ...incoming.accounts]
		: [...incoming.accounts];
	const normalized = accounts.map((account) => ({
		...account,
		active: account.id === incoming.activeAccountId,
	}));
	normalized.sort((left, right) => {
		if (left.active !== right.active) return left.active ? -1 : 1;
		return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
	});
	return { ...incoming, accounts: normalized };
}

export function writeCodexAccounts(
	queryClient: QueryClient,
	incoming: CodexAccountsResponse,
	mode: AccountMergeMode = "replace",
): void {
	queryClient.setQueryData<CodexAccountsResponse>(codexAccountsQueryKey, (current) =>
		mergeCodexAccounts(current, incoming, mode));
}

const reasonKeys = {
	account_valid: "This account is ready.",
	account_signed_out: "This account is signed out.",
	account_descriptor_invalid: "This account's saved details are invalid.",
	account_credential_home_missing: "This account's credential directory is missing.",
	account_unsafe_path: "This account uses an unsafe credential path.",
	authorized: "Codex is signed in.",
	unauthorized: "Codex reports this account as signed out.",
	not_applicable: "Authentication is not required for this account.",
	not_checked: "Authentication has not been checked yet.",
	auth_check_failed: "Authentication could not be checked.",
	auth_check_inconclusive: "The authentication check was inconclusive.",
	auth_check_timeout: "The authentication check timed out.",
	auth_check_unsupported: "Authentication checks are not supported.",
	auth_skipped_not_installed: "Authentication was not checked because Codex is not installed.",
	capacity_available: "Usage capacity is available.",
	capacity_near_limit: "Usage capacity is near its limit.",
	capacity_exhausted: "Usage capacity is exhausted.",
	capacity_unsupported: "Usage capacity is not available for this account.",
	capacity_not_checked: "Usage capacity has not been checked yet.",
	capacity_checking: "Checking usage limits…",
	capacity_check_failed: "Usage capacity could not be checked.",
	capacity_check_inconclusive: "The usage-capacity check was inconclusive.",
	capacity_check_timeout: "The usage-capacity check timed out.",
	capacity_skipped_auth_unknown: "Usage capacity was not checked because authentication is unknown.",
	capacity_skipped_signed_out: "Usage capacity was not checked because this account is signed out.",
	capacity_account_unavailable: "Usage capacity is unavailable for this account.",
	capacity_invalidated: "Usage capacity changed and must be checked again.",
	supported: "Supported.",
	unsupported: "Not supported.",
	unknown: "The current status is unavailable.",
	global_credential_store_unsupported: "This device account cannot be switched safely.",
	global_account_unverified: "The active device account could not be verified.",
	global_account_identity_unverified: "The active device account identity could not be verified.",
	global_account_changed: "The active device account changed outside AO.",
	login_pending: "Waiting for Codex sign-in.",
	login_completed: "Codex sign-in completed.",
	login_cancelled: "Codex sign-in was cancelled.",
	login_failed: "Codex sign-in failed.",
	login_unauthorized: "Codex still reports this account as signed out.",
	login_unverified: "AO could not verify the current authentication state.",
	login_expired: "Codex sign-in expired.",
	running_session_not_resumable: "A running session cannot be resumed after switching accounts.",
	switch_state_unavailable: "The account-switch state is unavailable.",
	session_operation_in_progress: "A session operation is already in progress.",
	stop_unconfirmed: "AO could not confirm that every session stopped.",
	activation_unconfirmed: "AO could not confirm the target account activation.",
	restart_unconfirmed: "AO could not confirm that every session restarted.",
	rollback_unconfirmed: "AO could not confirm the account rollback.",
	session_missing: "A session needed for this switch is missing.",
	source_generation_changed: "The source account changed during the switch.",
	reviewer_stop_unconfirmed: "AO could not confirm that a reviewer stopped.",
	reviewer_restart_unconfirmed: "AO could not confirm that a reviewer restarted.",
	reviewer_native_history_changed: "A reviewer's native history changed during the switch.",
	daemon_restart_recovery: "AO must recover this account switch after restarting.",
} as const;

export const codexAccountReasonCodes = Object.keys(reasonKeys) as Array<keyof typeof reasonKeys>;

export type CodexAccountMessage = string;

export function codexAccountReasonKey(reasonCode: string | null | undefined): CodexAccountMessage {
	return reasonKeys[reasonCode as keyof typeof reasonKeys] ?? "The current status is unavailable.";
}

export type CodexSwitchDisplay = {
	key: CodexAccountMessage;
	tone: "muted" | "warning" | "error";
	busy: boolean;
	mutationBlocked: boolean;
	canRecover: boolean;
};

export function codexSwitchDisplay(switchState: CodexAccountSwitch): CodexSwitchDisplay {
	const failureKey = switchState.failureCode ? codexAccountReasonKey(switchState.failureCode) : null;
	const failureKnown = failureKey !== "The current status is unavailable.";
	const phase = switchState.phase;
	const canRecover = switchState.canRecover && (phase === "rollback_required" || phase === "recovery_required");
	const terminal = phase === "completed" || phase === "failed" || phase === "recovery_required" || (phase === "rollback_required" && canRecover);
	const busy = !terminal;
	const phaseKeys: Record<CodexAccountSwitch["phase"], CodexAccountMessage> = {
		requested: "Preparing to switch the device account…",
		stopping_sessions: "Stopping running Codex sessions…",
		sessions_stopped: "Codex sessions stopped.",
		checkpointing_source: "Saving the current account state…",
		activating_target: "Activating the selected account…",
		verifying_target: "Verifying the selected account…",
		restarting_sessions: "Restarting Codex sessions…",
		rollback_required: "Restoring the previous Codex account…",
		recovery_required: "Some Codex sessions need recovery.",
		completed: "The device Codex account was switched.",
		failed: "The device Codex account could not be switched.",
	};
	return {
		key: !busy && failureKnown && failureKey ? failureKey : phaseKeys[phase] ?? "The account-switch status is unavailable.",
		tone: phase === "failed" ? "error" : failureKnown || phase === "rollback_required" || phase === "recovery_required" ? "warning" : "muted",
		busy,
		mutationBlocked: phase !== "completed" && phase !== "failed",
		canRecover,
	};
}
