// No baked Sentry DSN. Desktop, renderer, and the spawned daemon only send
// crash reports when AO_SENTRY_DSN / VITE_AO_SENTRY_DSN is set explicitly.
export const DEFAULT_SENTRY_DSN = "";
