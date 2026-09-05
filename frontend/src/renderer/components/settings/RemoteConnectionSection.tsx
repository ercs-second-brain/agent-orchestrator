import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveRemotePairingInput } from "../../../shared/desktop-remote";
import { aoBridge } from "../../lib/bridge";
import { useRemoteConnection } from "../../hooks/useRemoteConnection";
import { workspaceQueryKey } from "../../hooks/useWorkspaceQuery";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsOptionMenu, type SettingsOption } from "./SettingsOptionMenu";
import { Button } from "../ui/button";
import { SettingsInputRow } from "./SettingsRow";

const remoteConfigQueryKey = ["desktop-remote-config"] as const;

type ConnectionMode = "local" | "remote";

function readRemotePairingInput(input: {
	pairingText: string;
	host: string;
	port: string;
	password: string;
}) {
	return resolveRemotePairingInput({
		pairingText: input.pairingText,
		host: input.pairingText.trim() ? undefined : input.host,
		port: input.pairingText.trim() ? undefined : input.port,
		password: input.pairingText.trim() ? undefined : input.password,
	});
}

export function RemoteConnectionSection({ titleHidden }: { titleHidden?: boolean }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const isRemote = useRemoteConnection();
	const [mode, setMode] = useState<ConnectionMode>(isRemote ? "remote" : "local");
	const [pairingText, setPairingText] = useState("");
	const [host, setHost] = useState("");
	const [port, setPort] = useState("3011");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [identityHostId, setIdentityHostId] = useState<string | null>(null);

	const { data: remoteConfig } = useQuery({
		queryKey: remoteConfigQueryKey,
		queryFn: () => aoBridge.desktopRemote.getConfig(),
	});

	const connectMutation = useMutation({
		mutationFn: async () => {
			setError(null);
			const pairing = readRemotePairingInput({ pairingText, host, port, password });
			if (!pairing) {
				throw new Error("Paste a pairing code or enter host, port, and password.");
			}
			const result = await aoBridge.desktopRemote.connect({
				pairingText: pairingText.trim() || undefined,
				host: pairingText.trim() ? undefined : host.trim(),
				port: pairingText.trim() ? undefined : Number.parseInt(port, 10),
				password: pairingText.trim() ? undefined : password,
			});
			if (!result.ok) throw new Error(result.error);
			return result.config;
		},
		onSuccess: () => {
			queryClient.removeQueries({ queryKey: workspaceQueryKey });
			void queryClient.invalidateQueries({ queryKey: remoteConfigQueryKey });
			setMode("remote");
			setPassword("");
		},
		onError: (err: Error) => setError(err.message),
	});

	const disconnectMutation = useMutation({
		mutationFn: () => aoBridge.desktopRemote.disconnect(),
		onSuccess: async () => {
			void queryClient.invalidateQueries({ queryKey: remoteConfigQueryKey });
			setMode("local");
			setIdentityHostId(null);
		},
	});

	const probeMutation = useMutation({
		mutationFn: async () => {
			const pairing = readRemotePairingInput({ pairingText, host, port, password });
			if (!pairing) {
				throw new Error("Paste a pairing code or enter host and port before probing identity.");
			}
			return aoBridge.desktopRemote.probe({ host: pairing.host, port: pairing.port, secure: pairing.secure });
		},
		onSuccess: (result) => {
			if (result.ok) {
				setIdentityHostId(result.hostId);
				setError(null);
			} else {
				setIdentityHostId(null);
				setError("That host is not an AO daemon.");
			}
		},
		onError: (err: Error) => {
			setIdentityHostId(null);
			setError(err instanceof Error ? err.message : "Could not reach that host.");
		},
	});

	const modeOptions = [
		{ value: "local", label: t("settings.remote.modeLocal") },
		{ value: "remote", label: t("settings.remote.modeRemote") },
	] satisfies SettingsOption<ConnectionMode>[];

	const showingRemote = isRemote || mode === "remote";

	return (
		<SettingsSection title={t("settings.remote.title")} titleHidden={titleHidden}>
			<SettingsRow label={t("settings.remote.connection")}>
				<SettingsOptionMenu
					aria-label={t("settings.remote.connectionAria")}
					value={showingRemote ? "remote" : "local"}
					options={modeOptions}
					disabled={connectMutation.isPending || disconnectMutation.isPending}
					onChange={(next) => {
						setError(null);
						if (next === "local" && isRemote) {
							void disconnectMutation.mutate();
							return;
						}
						setMode(next);
					}}
				/>
			</SettingsRow>
			{isRemote && remoteConfig ? (
				<p className="px-3 pb-4 text-xs leading-relaxed text-muted-foreground">
					{t("settings.remote.connectedTo", {
						host: remoteConfig.host,
						port: remoteConfig.port,
						hostId: remoteConfig.hostId ? ` (${remoteConfig.hostId})` : "",
					})}
				</p>
			) : null}
			{showingRemote && !isRemote ? (
				<div className="flex flex-col gap-3 px-3 pb-4">
					<SettingsInputRow
						id="remote-pairing-code"
						label={t("settings.remote.pairingLabel")}
						value={pairingText}
						onChange={setPairingText}
						onCommit={setPairingText}
						onCancel={() => setPairingText("")}
						placeholder={t("settings.remote.pairingPlaceholder")}
					/>
					<p className="text-xs text-muted-foreground">{t("settings.remote.manualHint")}</p>
					<SettingsInputRow
						id="remote-host"
						label={t("settings.remote.hostLabel")}
						value={host}
						onChange={setHost}
						onCommit={setHost}
						onCancel={() => setHost("")}
						placeholder="192.168.1.50"
					/>
					<SettingsInputRow
						id="remote-port"
						label={t("settings.remote.portLabel")}
						value={port}
						onChange={setPort}
						onCommit={setPort}
						onCancel={() => setPort("3011")}
						placeholder="3011"
					/>
					<SettingsInputRow
						id="remote-password"
						label={t("settings.remote.passwordLabel")}
						value={password}
						onChange={setPassword}
						onCommit={setPassword}
						onCancel={() => setPassword("")}
						placeholder={t("settings.remote.passwordPlaceholder")}
					/>
					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="secondary" disabled={probeMutation.isPending} onClick={() => probeMutation.mutate()}>
							{t("settings.remote.verifyIdentity")}
						</Button>
						<Button type="button" disabled={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
							{t("settings.remote.connect")}
						</Button>
					</div>
					{identityHostId ? (
						<p className="text-xs text-muted-foreground">
							{t("settings.remote.verifiedHostId", { hostId: identityHostId })}
						</p>
					) : null}
					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}
				</div>
			) : null}
		</SettingsSection>
	);
}
