import type { ServerConfig } from "./config";

/**
 * How often to poll, given which endpoint won the race.
 *
 * The daemon pushes no event stream to the phone, so the REST poll is the only
 * live signal. Over a Cloudflare quick tunnel it is also slow (bodies are
 * forwarded in ~128 KB chunks), so the poll paces up on that path.
 *
 * See docs/adr/0004-cloudflare-tunnel-for-remote-mobile-access.md — still a
 * stopgap: the poll remains the only live signal on every path until the
 * existing /mux WebSocket carries app events too.
 */

/** Direct paths stream fine, so the poll stays cheap on battery and data. */
export const DIRECT_POLL_MS = 8_000;

/**
 * Over the tunnel the poll is the only live signal, so it has to be quick
 * enough to feel immediate. Deliberately a stopgap: it costs battery and data,
 * and it applies only while that path is in use.
 */
export const TUNNEL_POLL_MS = 2_000;

export function pollIntervalFor(cfg: ServerConfig | null): number {
	return cfg?.endpointKind === "tunnel" ? TUNNEL_POLL_MS : DIRECT_POLL_MS;
}
