import { useCallback, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { shellTerminalsQueryKey } from "./useShellTerminals";
import {
	cancelCodexAccountLogin,
	consumeCodexAccountResetCredit,
	deleteCodexAccount,
	ensureCodexAccounts,
	logoutCodexAccount,
	openCodexAccountLoginTerminal,
	openCodexAccountReauthenticationTerminal,
	recoverCodexAccountSwitch,
	startCodexAccountSwitch,
	verifyCodexAccountLogin,
	type CodexAccount,
	type CodexActiveLogin,
	type CodexAccountsResponse,
} from "./useCodexAccountsQuery";
import { codexAccountsQueryKey, writeCodexAccounts } from "./codex-accounts-state";

function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function useCodexAccountActions(queryClient: QueryClient) {
	const [error, setError] = useState<string | null>(null);
	const [loginPending, setLoginPending] = useState(false);
	const [loginOperationPending, setLoginOperationPending] = useState(false);
	const [recoverPending, setRecoverPending] = useState(false);
	const verifyingRef = useRef<string | null>(null);

	const current = useCallback(() => queryClient.getQueryData<CodexAccountsResponse>(codexAccountsQueryKey), [queryClient]);
	const writeCurrent = useCallback((update: (snapshot: CodexAccountsResponse) => CodexAccountsResponse) => {
		const snapshot = current();
		if (snapshot) writeCodexAccounts(queryClient, update(snapshot), "replace");
	}, [current, queryClient]);

	const beginLogin = useCallback(async (accountId?: string) => {
		setError(null);
		setLoginPending(true);
		try {
			const started = accountId
				? await openCodexAccountReauthenticationTerminal(accountId)
				: await openCodexAccountLoginTerminal();
			writeCurrent((snapshot) => ({
				...snapshot,
				activeLogin: {
					operationId: started.operation.operationId,
					accountId: started.operation.accountId ?? accountId,
					status: started.operation.status,
					reasonCode: started.operation.reasonCode,
					reason: started.operation.reason,
					expiresAt: started.operation.expiresAt,
					shellTerminal: started.shellTerminal,
				},
			}));
			void queryClient.invalidateQueries({ queryKey: shellTerminalsQueryKey });
		} catch (cause) {
			setError(errorMessage(cause, "Could not open the Codex login terminal."));
			throw cause;
		} finally {
			setLoginPending(false);
		}
	}, [queryClient, t, writeCurrent]);

	const verifyLogin = useCallback(async (login: CodexActiveLogin) => {
		const key = `${login.operationId}:${login.shellTerminal.handleId}`;
		if (verifyingRef.current === key) return;
		verifyingRef.current = key;
		setError(null);
		setLoginOperationPending(true);
		writeCurrent((snapshot) => snapshot.activeLogin?.operationId === login.operationId
			? { ...snapshot, activeLogin: { ...snapshot.activeLogin, status: "verifying" } }
			: snapshot);
		try {
			const operation = await verifyCodexAccountLogin(login.operationId);
			writeCurrent((snapshot) => {
				const accounts = operation.account
					? [...snapshot.accounts.filter((account) => account.id !== operation.account?.id), operation.account]
					: snapshot.accounts;
				const activeAccountId = operation.account?.active ? operation.account.id : snapshot.activeAccountId;
				const activeLogin = operation.status === "completed" ? undefined : {
					...login,
					accountId: operation.accountId ?? login.accountId,
					status: operation.status,
					reasonCode: operation.reasonCode,
					reason: operation.reason,
					expiresAt: operation.expiresAt,
				};
				return { ...snapshot, accounts, activeAccountId, activeLogin };
			});
			if (operation.status === "completed") void queryClient.invalidateQueries({ queryKey: shellTerminalsQueryKey });
			return operation;
		} catch (cause) {
			setError(errorMessage(cause, "Could not check the Codex authentication state. Check again when the daemon is available."));
			writeCurrent((snapshot) => snapshot.activeLogin?.operationId === login.operationId
				? { ...snapshot, activeLogin: { ...snapshot.activeLogin, status: "unverified", reasonCode: "login_unverified" } }
				: snapshot);
			throw cause;
		} finally {
			verifyingRef.current = null;
			setLoginOperationPending(false);
		}
	}, [queryClient, t, writeCurrent]);

	const closeLogin = useCallback(async (login: CodexActiveLogin) => {
		setError(null);
		setLoginOperationPending(true);
		try {
			const operation = await cancelCodexAccountLogin(login.operationId);
			writeCurrent((snapshot) => ({
				...snapshot,
				activeLogin: operation.status === "cancelled" ? undefined : {
					...login,
					status: operation.status,
					reasonCode: operation.reasonCode,
					reason: operation.reason,
					expiresAt: operation.expiresAt,
				},
			}));
			void queryClient.invalidateQueries({ queryKey: shellTerminalsQueryKey });
		} catch (cause) {
			setError(errorMessage(cause, "Could not stop the Codex sign-in terminal. Settings will stay open."));
			throw cause;
		} finally {
			setLoginOperationPending(false);
		}
	}, [queryClient, t, writeCurrent]);

	const retryLogin = useCallback(async (login: CodexActiveLogin) => {
		await closeLogin(login);
		await beginLogin(login.accountId);
	}, [beginLogin, closeLogin]);

	const ensureAccount = useCallback(async (accountId: string) => {
		const next = await ensureCodexAccounts([accountId], true);
		writeCodexAccounts(queryClient, next, "preserveMissing");
	}, [queryClient]);

	const switchAccount = useCallback(async (account: CodexAccount, revision: number, idempotencyKey: string) => {
		setError(null);
		try {
			const nextSwitch = await startCodexAccountSwitch(account.id, revision, idempotencyKey);
			writeCurrent((snapshot) => ({ ...snapshot, currentSwitch: nextSwitch }));
		} catch (cause) {
			setError(errorMessage(cause, "Could not start the Codex account switch."));
			throw cause;
		}
	}, [writeCurrent]);

	const recoverSwitch = useCallback(async (switchId: string) => {
		setError(null);
		setRecoverPending(true);
		try {
			const nextSwitch = await recoverCodexAccountSwitch(switchId);
			writeCurrent((snapshot) => ({ ...snapshot, currentSwitch: nextSwitch }));
		} catch (cause) {
			setError(errorMessage(cause, "Could not retry the failed Codex sessions."));
			throw cause;
		} finally {
			setRecoverPending(false);
		}
	}, [writeCurrent]);

	const resetAccount = useCallback(async (account: CodexAccount, idempotencyKey: string) => {
		setError(null);
		try { writeCodexAccounts(queryClient, await consumeCodexAccountResetCredit(account.id, idempotencyKey), "replace"); }
		catch (cause) { setError(errorMessage(cause, "Could not reset the Codex usage limits.")); throw cause; }
	}, [queryClient]);

	const logoutAccount = useCallback(async (account: CodexAccount) => {
		setError(null);
		try { writeCodexAccounts(queryClient, await logoutCodexAccount(account.id), "replace"); }
		catch (cause) { setError(errorMessage(cause, "Could not log out of the Codex account.")); throw cause; }
	}, [queryClient]);

	const deleteAccount = useCallback(async (account: CodexAccount) => {
		setError(null);
		try { writeCodexAccounts(queryClient, await deleteCodexAccount(account.id), "replace"); }
		catch (cause) { setError(errorMessage(cause, "Could not delete the Codex account.")); throw cause; }
	}, [queryClient]);

	return {
		error,
		loginPending,
		loginOperationPending,
		recoverPending,
		beginLogin,
		verifyLogin,
		closeLogin,
		retryLogin,
		ensureAccount,
		switchAccount,
		recoverSwitch,
		resetAccount,
		logoutAccount,
		deleteAccount,
	};
}
