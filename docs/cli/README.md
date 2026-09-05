# AO CLI

The `ao` CLI is a thin Go/Cobra client for the local Agent Orchestrator daemon.
It starts, discovers, inspects, and stops the daemon through the loopback HTTP
surface and the `running.json` handshake. It must not open SQLite directly or
call runtime, workspace, tracker, or agent adapters in-process.

When using the CLI directly from a shell, make sure the daemon is running first
with `ao start` or by opening the desktop app. Product commands such as
`ao agent ls` and `ao spawn` call the loopback daemon and will fail with a
"daemon is not running" error if no `running.json` points at a live process. From
a source checkout, build and run the local binary explicitly, for example:

```bash
cd backend
go build -o ./bin/ao ./cmd/ao
./bin/ao agent ls
```

## Current commands

Every product command resolves to a daemon HTTP route. Run `ao <command>
--help` for the authoritative flag shape.

### Daemon control

| Command                       | Purpose                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ao start`                    | Start the daemon in the background and wait for `/readyz`.                                                                        |
| `ao stop`                     | Gracefully stop the daemon via loopback `POST /shutdown` after verifying daemon identity.                                         |
| `ao status` / `--json`        | Report daemon state from `running.json`, process liveness, `/healthz`, and `/readyz`.                                             |
| `ao doctor` / `--json`        | Check config, data directory, DB-file presence, daemon state, `git`, and (on Darwin/Linux) `tmux`; on Windows conpty is built in. |
| `ao completion <shell>`       | Generate completions for `bash`, `zsh`, `fish`, or `powershell`.                                                                  |
| `ao version` / `ao --version` | Print build metadata.                                                                                                             |
| `ao daemon`                   | Run the AO backend daemon in the foreground (headless VM/systemd entrypoint). See [headless-vm.md](../headless-vm.md).          |
| `ao mobile`                   | Manage the Connect Mobile LAN listener (`status`, `enable`, `disable`, `regenerate`, `pairing-code`).                               |

### Product commands

| Command                             | Daemon route                                   |
| ----------------------------------- | ---------------------------------------------- |
| `ao project add`                    | `POST /api/v1/projects`                        |
| `ao project ls`                     | `GET /api/v1/projects`                         |
| `ao project get <id>`               | `GET /api/v1/projects/{id}`                    |
| `ao project set-config <id>`        | `PUT /api/v1/projects/{id}/config`             |
| `ao project rm <id>`                | `DELETE /api/v1/projects/{id}`                 |
| `ao agent ls`                       | `POST /api/v1/agents/readiness/ensure` (`display`) |
| `ao agent ls --refresh`             | `POST /api/v1/agents/refresh` (forced checks) |
| `ao spawn`                          | Targeted launch ensure, then `POST /api/v1/sessions` |
| `ao session ls`                     | `GET /api/v1/sessions`                         |
| `ao session get <id>`               | `GET /api/v1/sessions/{id}`                    |
| `ao session kill <id>`              | `POST /api/v1/sessions/{id}/kill`              |
| `ao session restore <id>`           | `POST /api/v1/sessions/{id}/restore`           |
| `ao session exit-agent <id>`        | `POST /api/v1/sessions/{id}/exit-agent`        |
| `ao session resume-agent <id>`      | `POST /api/v1/sessions/{id}/resume-agent`      |
| `ao session switch-agent <id> <target-harness>` | `POST /api/v1/sessions/{id}/switch-agent` |
| `ao session agent-switch ls <session-id>` | `GET /api/v1/sessions/{id}/agent-switches` |
| `ao session handoff submit`         | `POST /api/v1/sessions/{id}/agent-switches/{switchId}/handoff` |
| `ao session rename <id> <name>`     | `PATCH /api/v1/sessions/{id}`                  |
| `ao session cleanup`                | `POST /api/v1/sessions/cleanup`                |
| `ao session claim-pr [<id>] <pr-ref>` | `POST /api/v1/sessions/{id}/pr/claim`        |
| `ao orchestrator ls`                | `GET /api/v1/orchestrators`                    |
| `ao send`                           | `POST /api/v1/sessions/{id}/send`              |
| `ao hooks <agent> <event>`          | `POST /api/v1/sessions/{id}/activity` (hidden) |

`ao agent ls` asks the daemon to ensure display readiness, then prints the
existing table or legacy JSON projection. The daemon alone decides whether a
native check is needed. `--refresh` is a deprecated compatibility flag that
forces fresh installation and authentication checks before printing.

`ao spawn` resolves project context in this order: explicit `--project`,
`AO_PROJECT_ID`, `AO_SESSION_ID` (by fetching the current session from the
daemon), then the current working directory matched against registered project
paths. If `AO_SESSION_ID` is set but the session cannot be fetched, pass
`--project` explicitly.

Agent switching is initially available only for worker sessions whose source
and target harnesses are Claude Code or Codex. The main command
accepts an idempotency key:

```bash
ao session switch-agent ao-7 codex \
  --idempotency-key switch-ao-7-to-codex

ao session agent-switch ls ao-7 --json
```

`switch-agent` and `agent-switch ls` both support `--json`.
The `agent-switch` command also has the `agent-switches` alias, and `ls` has the
`list` alias.

`ao session handoff submit` is the internal source-agent path for optional
semantic enrichment, not a required human step in a normal switch. It requires
the switch ID, exact source launch generation, and a regular file containing
one JSON object no larger than 64 KiB. `--session` defaults to
`AO_SESSION_ID`:

```bash
AO_SESSION_ID=ao-7 ao session handoff submit \
  --switch switch-123 \
  --source-generation generation-456 \
  --file /tmp/ao-handoff.json \
  --json
```

Switching preserves the AO worker session and worktree. It does not translate,
clip, or rewrite provider transcript files; providers continue to own their
native history and compaction.

`ao session claim-pr <pr-ref>` attaches a PR to the current worker by reading
`AO_SESSION_ID`. From an orchestrator or external shell, pass the target
explicitly with `ao session claim-pr <session-id> <pr-ref>`. The explicit form
remains supported for backward compatibility and cross-session coordination.

If the resolved project has no `worker.agent` config, `ao spawn` fails with a
usage error asking for explicit configuration. Before spawning, the CLI
performs one targeted launch ensure. It fails early for unsupported or
definitely missing harnesses and warns-but-continues for unauthorized or
unknown observations; daemon session creation repeats launch validation and
native launch remains authoritative. `--skip-agent-check` suppresses only the
CLI warnings and early check, never the daemon validation.

`go run .` in `backend/` remains a compatibility wrapper around the daemon.

PR actions are available through `ao pr merge` and
`ao pr resolve-comments`. Review actions are available through `ao review ls`,
`ao review trigger` (also `execute` and `restart`), `ao review cancel` (also
`stop`), and `ao review submit`.

## Configuration

The CLI and daemon share the same environment-driven config:

| Var                   | Default              | Purpose                                                                                        |
| --------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `AO_PORT`             | `3001`               | Loopback daemon port.                                                                          |
| `AO_RUN_FILE`         | `~/.ao/running.json` | PID/port handshake.                                                                            |
| `AO_DATA_DIR`         | `~/.ao/data`         | SQLite data directory.                                                                         |
| `AO_REQUEST_TIMEOUT`  | `60s`                | REST request timeout.                                                                          |
| `AO_SHUTDOWN_TIMEOUT` | `10s`                | Graceful shutdown cap.                                                                         |
| `AO_KEEP_DAEMON`      | unset (off)          | Keep the desktop app's daemon running after the window closes; stop only via `ao stop`. (fork) |
| `AO_DISABLE_GPU`      | unset (off)          | Skip Chromium hardware acceleration; escape hatch for broken Linux GPU drivers.                |

The daemon always binds `127.0.0.1`.

## Manual smoke test

```bash
cd backend
go build -o /tmp/ao ./cmd/ao

tmp=$(mktemp -d)
export AO_RUN_FILE="$tmp/running.json"
export AO_DATA_DIR="$tmp/data"
export AO_PORT=3037

/tmp/ao status --json
/tmp/ao doctor
/tmp/ao start
/tmp/ao status --json
/tmp/ao stop
/tmp/ao status --json
rm -rf "$tmp"
```

## Adding new commands

Add a product command only when a daemon HTTP route owns the corresponding
mutation/read; the CLI must call that route rather than reimplementing daemon
behavior. Commands not yet exposed but with backend routes in place include
`ao events ...` (over the CDC/SSE endpoint) and CLI parity for PR/review
actions.

Do not port old in-process TypeScript CLI behavior that mixed command handling
with storage and runtime implementation details.
