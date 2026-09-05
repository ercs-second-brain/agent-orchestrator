import { RadioGroup } from "radix-ui";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";

export type SetupMode = "lan" | "tailscale";

// Maps a `securePairing.reason` from the daemon to the copy explaining it. An
// unknown reason (e.g. a newer daemon build) returns undefined and renders
// nothing rather than a raw translation key.
export function reasonMessage(reason: string): string | undefined {
	switch (reason) {
		case "no_cli":
		case "no_magicdns":
			return "The tailscale command isn't available, or MagicDNS is off. Install the Tailscale CLI and enable MagicDNS, then reopen this window.";
		case "no_certs":
			return "Enable HTTPS certificates for your tailnet in the Tailscale admin console (DNS page), then reopen this window.";
		case "serve_failed":
			return "Couldn't start the Tailscale proxy. Port 443 may already be in use by another serve target.";
		case "port_mismatch":
			return "The Tailscale proxy is pointing somewhere else. Turn secure pairing off and on again.";
		case "clear_failed":
			return "Secure pairing is off, but the Tailscale proxy may still be running. Run `tailscale serve --https=443 off` to remove it.";
		default:
			return undefined;
	}
}

interface ConnectMobileSetupProps {
	/** The selected connection method. Owned by the Mobile settings page, which encodes the
	 *  matching address into the pairing QR. */
	mode: SetupMode;
	onModeChange: (mode: SetupMode) => void;
	/**
	 * False while the bridge is off; the steps are then collapsed, so their
	 * controls must leave the tab order (same pattern as the pairing block).
	 */
	enabled: boolean;
	/**
	 * True while any bridge mutation (enable/disable/regenerate/secure-pairing)
	 * is in flight. Disables the secure-pairing switch so a user can't fire a
	 * second toggle mid round-trip — the secure-pairing POST can take several
	 * seconds (up to three chained `tailscale` subprocess calls).
	 */
	busy?: boolean;
	/** Secure-pairing (Tailscale TLS) state, owned by the Mobile settings page. */
	secure: { enabled: boolean; reason: string };
	onSecureChange: (on: boolean) => void;
}

// ConnectMobileSetup tells the user what to do with the pairing QR above it and
// which address that QR carries. The mode is owned by the Mobile settings page so the
// QR can re-encode: LAN mode encodes the private IPv4 from AutopickLANIP, and
// Tailscale mode encodes the 100.64.0.0/10 address from AutopickTailscaleIP
// (backend/internal/mobilebridge/netiface.go), or the MagicDNS host over 443
// when secure pairing is active.
export function ConnectMobileSetup({ mode, onModeChange, enabled, busy = false, secure, onSecureChange }: ConnectMobileSetupProps) {
	const reasonText = reasonMessage(secure.reason);

	// Margin-free on purpose: the parent settings page owns the spacing around this block.
	return (
		<div className="flex w-full flex-col items-center">
			<RadioGroup.Root
				value={mode}
				onValueChange={(value) => onModeChange(value as SetupMode)}
				aria-label={"Connection method"}
				className="settings-segment rounded-md"
			>
				<RadioGroup.Item value="lan" tabIndex={enabled ? 0 : -1} className="settings-segment-item rounded-md">
					{"LAN"}
				</RadioGroup.Item>
				<RadioGroup.Item value="tailscale" tabIndex={enabled ? 0 : -1} className="settings-segment-item rounded-md">
					{"Tailscale"}
				</RadioGroup.Item>
			</RadioGroup.Root>

			{mode === "lan" ? (
				<div className="mt-3 w-full px-(--size-settings-mobile-details-pad-x)">
					<ol className="settings-mobile-steps">
						<li>{"Put your phone on the same Wi-Fi as this computer."}</li>
						<li>{"Open Agent Orchestrator on your phone and tap Scan."}</li>
						<li>{"Scan the code below — address and password fill in automatically."}</li>
					</ol>
				</div>
			) : (
				<div className="mt-3 w-full px-(--size-settings-mobile-details-pad-x)">
					<div className="relative flex items-start justify-between gap-3 rounded-(--radius-settings-dialog-lg) border border-[var(--color-border-settings-input)] bg-[var(--color-bg-settings-input)] px-3.5 py-2.5">
						<div className="flex min-w-0 flex-col gap-1 pr-2">
							<span className="text-subtitle leading-(--leading-settings-mobile-title) text-settings-label">
								{"Secure pairing (TLS)"}
							</span>
							<span className="text-caption leading-(--leading-settings-mobile-hint) text-settings-muted">
								{"Always on for Tailscale. iOS blocks unencrypted connections to Tailscale addresses; Android works either way."}
							</span>
						</div>
						<Switch
							checked={secure.enabled}
							onCheckedChange={onSecureChange}
							disabled={!enabled || busy}
							aria-label={"Secure pairing (TLS)"}
							tabIndex={enabled ? 0 : -1}
							className={cn(
								"h-(--size-settings-mobile-switch-h) w-(--size-settings-mobile-switch-w) shrink-0 transition-colors duration-300 ease-out",
								"data-[state=checked]:bg-settings-switch-on data-[state=unchecked]:bg-[var(--color-border-settings-input)]",
								"focus-visible:ring-0 focus-visible:ring-offset-0",
								"**:data-[slot=switch-thumb]:size-5 **:data-[slot=switch-thumb]:bg-white **:data-[slot=switch-thumb]:transition-transform **:data-[slot=switch-thumb]:duration-300 **:data-[slot=switch-thumb]:ease-out",
								"data-[state=checked]:**:data-[slot=switch-thumb]:translate-x-(--size-settings-mobile-switch-travel)",
								"data-[state=unchecked]:**:data-[slot=switch-thumb]:translate-x-0.5",
							)}
						/>
					</div>

					<p className="mt-3 text-caption leading-(--leading-settings-mobile-hint) text-settings-muted">
						{"iPhone needs secure pairing turned on — iOS blocks unencrypted connections to Tailscale addresses. Android works either way."}
					</p>

					{secure.enabled && reasonText && (
						<p className="mt-3 text-caption leading-(--leading-settings-mobile-hint) text-warning">{reasonText}</p>
					)}

					<ol className="settings-mobile-steps mt-3">
						<li>{"Install Tailscale here and on your phone, signed into the same account."}</li>
						<li>
							{"Run"}{" "}
							<span className="tracking-settings-mono text-settings-label">tailscale ip -4</span>{" "}
							{"here to get your 100.x address."}
						</li>
						<li>{"Scan the code below — your Tailscale address and password fill in automatically."}</li>
					</ol>
				</div>
			)}
		</div>
	);
}
