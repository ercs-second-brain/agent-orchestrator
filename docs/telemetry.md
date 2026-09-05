# Product telemetry

This build does **not** phone home.

There is no product-analytics export. Crash reporting (Sentry) ships with an
empty key and does not capture anything unless an operator explicitly sets:

- `AO_SENTRY_DSN` / `VITE_AO_SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN`

Local event recording in SQLite can still run for on-device diagnostics. That
data stays under `~/.ao` and is never uploaded by default.

The Settings toggle labeled "Share error events" only has an effect when a
Sentry DSN is configured. Without one, it cannot send anything off-machine.
