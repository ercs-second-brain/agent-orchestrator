# agent-orchestrator status

Current `main` ships a working single-user local loop: the Go daemon and the
Electron/React frontend both drive a live daemon over HTTP/SSE/WebSocket. The
core GitHub flow works end-to-end: add project → spawn session/orchestrator →
attach terminal → observe PR → merge.

Chat and browser features were removed in full by
[#39](https://github.com/ercs-second-brain/agent-orchestrator/issues/39)
(cleanup program): there is no chat driver, no embedded browser runtime, and no
preview server. Sessions are terminal-first — agents run in their own tmux/conpty
TUI, and clients attach through the daemon's mux. Conversation and
interface-transition tables written by the removed chat stack remain in SQLite
readable but inert until a deliberate migration decision.

This file tracks progress. For what the product _is_ and how to run it, see the
top-level [`README.md`](../README.md); for the backend mental model see
[`architecture.md`](architecture.md).

## Build & test

The local gate is the backend Go build and race-enabled test suite:

```bash
cd backend && go build ./... && go test -race ./...
```

`npm run lint` (from the repo root) runs `go test ./...` plus golangci-lint.
Frontend checks live under `frontend/` (`npm run typecheck`, `npm run build`).
See [`AGENTS.md`](../AGENTS.md) for the regen workflow when touching the API
surface (`npm run sqlc`, `npm run api`).

## Shipped

### Backend (Go daemon)

- Loopback-only HTTP daemon (chi router, CORS, per-request timeout,
  `/healthz` / `/readyz` / `/shutdown`).
- SQLite store with goose migrations and sqlc-generated queries; DB
  trigger-based change-data-capture into `change_log`.
- CDC poller + broadcaster feeding in-process subscribers and the SSE stream
  at `GET /api/v1/events` (with `Last-Event-ID` replay).
- Full session lifecycle over HTTP: list, get, spawn, kill, restore, rename,
  rollback, cleanup, send, activity, PR claim/list. Orchestrator routes
  (list/spawn/get) are wired too.
- One agent interface per session: the terminal. Every session runs its agent
  inside a tmux/conpty runtime and dispatches lifecycle reactions through the
  session manager; the mux is the way every client — desktop, mobile, CLI —
  reaches the agent. Sessions spawned before chat was removed (#39) that persist
  a `chat` mode are inert historical rows.
- Codex account management under Settings → Agents. AO reconciles the current
  device-global Codex identity, adds file-backed accounts through an inline
  native login terminal, and shows structured authentication, capacity, usage,
  and confirmed reset-credit facts without parsing credentials. A manual global
  switch fences input, stops and resumes only the affected AO-owned Codex
  controllers with the same native thread IDs, and leaves native history in the
  normal Codex home. Users can sign accounts out and delete inactive signed-out
  accounts; external Codex clients are not controlled.
- Project CRUD plus per-project config (`PUT /projects/{id}/config`).
- PR action engine wired into the API: `POST /prs/{id}/merge` and
  `/prs/{id}/resolve-comments`.
- Review routes registered: `GET /reviews`, `POST /reviews/execute`,
  `POST /reviews/{id}/send`.
- Interactive reviewer panes for Aider, Agy, Amp, Auggie, Autohand,
  Claude Code, Cline, Codex, Continue, GitHub Copilot, Crush, Cursor, Devin,
  Droid, Goose, Grok, Kilo Code, Kimchi, Kiro, Kimi, OpenCode, Pi, Qwen, and Vibe. Pi uses an AO-data-owned extension with built-in/project
  resources disabled, structured read-only inspection/reporting tools, and
  Escape-based turn cancellation. Kiro also uses its native Escape
  cancellation. Continue, Qwen, and Vibe also use Escape cancellation. Agy,
  Continue, Devin, Droid, Goose, Kimchi, Kimi, Qwen, and Vibe are explicitly experimental and host-trusted. Grok, Crush, Auggie, Cline, and Autohand are experimental user-approved reviewers that retain their native approval prompts instead of receiving broad unattended flags:
  native modes, autonomous settings, and prompts are not OS or network containment.
- The provider-neutral interactive-reviewer capability gateway and neutral
  AO-owned working-directory contract are available. The experimental
  host-trusted adapters remain candidates for future contained execution once
  their documented sandbox, environment-replacement, broker, and gateway
  prerequisites are implemented.
- Durable dashboard notifications for `needs_input`, `ready_to_merge`,
  `pr_merged`, and `pr_closed_unmerged`: backend enrichment/persistence,
  cursor-paginated read/unread history, live notification stream, and read
  acknowledgement API.
- SCM observer (`internal/observe/scm`) wired into the daemon: GitHub provider,
  lazy/non-blocking auth, per-PR polling with ETag guards and semantic diffing,
  feeding PR facts into lifecycle, which sends agent nudges for CI failures,
  review feedback, and merge conflicts
  ([#75](https://github.com/ercs-second-brain/agent-orchestrator/issues/75),
  [#108](https://github.com/ercs-second-brain/agent-orchestrator/issues/108),
  [#109](https://github.com/ercs-second-brain/agent-orchestrator/issues/109)).
- Terminal mux over WebSocket (`/mux`): detached native PTY host for new macOS
  sessions, per-client `tmux attach` for Linux and persisted legacy macOS
  handles, and a ConPTY loopback host on Windows.
- Lifecycle reducer plus reaper (`internal/observe/reaper`).
- Agent adapter platform under `internal/adapters/agent/` (25 adapters) with a
  registry and `ao hooks` activity dispatch.
- Daemon-owned in-memory agent readiness coordination with normalized
  installation/authentication observations, purpose-specific freshness,
  single-flight checks, bounded warm-up/retries, launch-time validation, and
  compatibility projections for older agent inventory/probe clients.
- OpenAPI spec generated from Go DTOs; frontend TS types generated from it and
  drift-checked in CI.

### Frontend (Electron + React)

- Electron + React 19 + TanStack Router/Query + Tailwind + shadcn primitives.
- Real daemon wiring via the generated `openapi-fetch` typed client
  (`src/api/schema.ts`); mock data only in `VITE_NO_ELECTRON` web-preview mode.
- Agent pickers consume the normalized readiness snapshot, show cached state
  immediately, and delegate open/focus/selection freshness decisions to the
  daemon coordinator.
- Electron main handles daemon discovery, launch, and status reporting.
- Shell: sidebar (projects + sessions, add/remove project), sessions board,
  session view + inspector, project settings, pull-requests page,
  spawn-orchestrator flow.
- SessionView is terminal-first: the terminal surface (xterm over the mux) is
  the session's agent interface. Chat and browser panels were removed by #39.
- Desktop status and SCM summary V1: session status comes from
  `GET /api/v1/sessions`; visible/active PR context comes from
  `GET /api/v1/sessions/{sessionId}/pr`; `GET /api/v1/events` is kept open as
  an invalidation stream rather than a full PR payload stream.
- Concise PR summaries include PR identity, CI state with failing check names
  and links, human reviewer IDs/counts/links for unresolved review comments,
  and mergeability reasons. Raw CI logs and review comment bodies are
  intentionally not part of the desktop V1 API/UI.
- Terminal pane (xterm) over the mux WebSocket, with a live SSE events
  connection and port-rebind on daemon restart.
- In-app notification center with click access, Unread/All filters, paginated
  REST catch-up, live notification stream updates, separate PR/session target
  actions, persistent read history, mark-read controls, and Electron app toasts
  while the app is running.
- Desktop remote-daemon mode: the app can pair with a remote host's opt-in LAN
  listener from Settings → General → AO server (paste the `ao mobile
  pairing-code` payload or an `aomobile://pair` link), attach over the
  authenticated bearer endpoint without starting a local daemon, and drive
  sessions and terminal remotely — see [`headless-vm.md`](headless-vm.md).

### Mobile (Expo + React Native)

- Connect Mobile pairs with the daemon's opt-in authenticated LAN listener; the
  loopback listener and its security model remain unchanged.
- Sessions are terminal-first: the phone attaches the session's mux PTY and
  mirrors the agent's TUI with xterm, with a composer (agent send + raw
  terminal routes), voice dictation, key row, zoom, kill/restore, and a
  session-scoped worktree shell through the same terminal mux. Chat screens and
  the TUI↔Chat handoff were removed by #39.

## In flight / not yet a runtime feature

- **Tracker lifecycle mirroring (issue → session direction is shipped)**: the
  daemon runs an opt-in issue-intake observer (`internal/observe/trackerintake`)
  that polls a project's configured tracker and spawns one worker session per
  eligible open issue, gated by assignee eligibility
  (`ProjectConfig.TrackerIntake.Assignee`), with GitHub and GitLab adapters
  under `internal/adapters/tracker/`. What remains unshipped is the reverse
  direction: writing session/agent lifecycle state back to issues (comments,
  status/label transitions, `tracker_*` CDC facts) — the tracker adapters are
  read-only today.
- **Full raw PR/tracker fact surfacing**: the SCM observer writes facts and the
  desktop consumes concise PR summaries, but exposing the full raw `pr_*` /
  `tracker_*` CDC events to live consumers
  ([#110](https://github.com/ercs-second-brain/agent-orchestrator/issues/110)) and in
  `ao session get` ([#111](https://github.com/ercs-second-brain/agent-orchestrator/issues/111))
  is still open.

Tracking milestone:
[`rewrite`](https://github.com/ercs-second-brain/agent-orchestrator/milestone/1).
