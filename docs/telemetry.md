# Product telemetry

This build does **not** phone home.

Remote product telemetry (PostHog) and crash reporting (Sentry) ship with empty
keys. The desktop app, the daemon it starts, and the mobile companion do not
export events unless an operator explicitly sets:

- `AO_TELEMETRY_REMOTE=posthog`
- `AO_TELEMETRY_POSTHOG_KEY` / `VITE_AO_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_KEY`
- `AO_SENTRY_DSN` / `VITE_AO_SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN`

Local event recording in SQLite can still run for on-device diagnostics. That
data stays under `~/.ao` and is never uploaded by default.

The Settings toggle labeled "Share error events" only has an effect when a
remote key is configured. Without one, it cannot send anything off-machine.
