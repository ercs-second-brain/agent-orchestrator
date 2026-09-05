# Headless VM host

Run one AO daemon on a Linux server (for example a Proxmox VM) and use Mac,
Windows, and Android as thin clients over your LAN. The daemon owns SQLite,
worktrees, agent processes, and GitHub observation; clients talk to the
authenticated **Connect Mobile** LAN listener.

## Architecture

```
phone / Mac / Windows desktop  ──HTTP/SSE/WS + bearer password──►  0.0.0.0:3011 (LAN)
                                                                          │
                                                                    ao daemon
                                                                          │
                                                              pi / tmux / worktrees
```

The loopback listener (`127.0.0.1:3001`) stays unauthenticated and is for
on-box CLI only. Do not expose it beyond the VM.

## VM prerequisites

| Component | Purpose |
| --- | --- |
| Linux amd64 | Ship target (`ao-linux-x64` from releases or `packages/build-binaries.sh`) |
| `git` | Projects and worktrees |
| `tmux` | TUI agent sessions |
| `gh` or `AO_GITHUB_TOKEN` | PR observation, merge actions, and **Create a new Git repository**. Token needs `repo` and `read:org`. The daemon process must see the same auth as an SSH shell — `gh auth login` as the service user, or `Environment=AO_GITHUB_TOKEN=…` on the systemd unit. Interactive `GH_TOKEN` in `.bashrc` is not inherited. |
| `pi` | Pi TUI harness — auto-provisioned by AO on first daemon start (see [pi provisioning](#pi-provisioning)); a PATH install is only a fallback |

Install Pi credentials in the VM user's normal Pi config directory
(`~/.pi/agent` or `PI_CODING_AGENT_DIR`). AO provisions the pi binary itself;
it does not bundle provider credentials.

## Install AO on the VM

From a release artifact or a local build:

```bash
# Example: copy the linux binary into PATH
install -m 0755 ao-linux-x64/bin/ao ~/.local/bin/ao
```

All AO state lives under `~/.ao` (override with `AO_DATA_DIR`).

## Run the daemon under systemd

Create `~/.config/systemd/user/ao-daemon.service`:

```ini
[Unit]
Description=Agent Orchestrator daemon
After=network-online.target

[Service]
Type=simple
ExecStart=%h/.local/bin/ao daemon
Restart=on-failure
RestartSec=5
Environment=HOME=%h
# systemd does not source .bashrc. Interactive `pi --version` / `which pi` is
# not enough — copy the directories that contain `pi` and `node` from an SSH
# `echo $PATH` (nvm/fnm/volta bins included).
Environment=PATH=%h/.local/bin:%h/.pi/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ao-daemon.service
systemctl --user status ao-daemon.service
```

Confirm loopback health:

```bash
curl -sf http://127.0.0.1:3001/readyz
```

## pi provisioning

AO manages the pi binary it launches (ADR 0005). On every daemon start the
provisioning service makes sure the **pinned** pi version for the current AO
release exists under the AO data dir, downloading it if missing and
checksum-verifying it against the release's published `SHA256SUMS`:

- Store location: `~/.ao/bin/pi/<version>/pi` (`%AO_DATA_DIR%\bin\pi\...` on
  Windows; `AO_DATA_DIR` moves the whole store with the rest of AO state).
- Download source: pi's GitHub releases
  (`github.com/earendil-works/pi`), platform artifacts `pi-linux-x64.tar.gz`,
  `pi-darwin-arm64.tar.gz`, `pi-darwin-x64.tar.gz`, and `pi-windows-x64.zip`.
- Platforms: linux-x64, darwin-arm64, darwin-x64, win32-x64. Anything else
  relies on the PATH fallback.
- Old pinned versions are deleted automatically after a successful re-pin, so
  the store holds at most one version.

Binary resolution order for session spawn:

1. `AO_PI_BINARY` — explicit user override (must be an executable file).
2. The AO-provisioned pinned binary.
3. `PATH` / npm-global installs — the pre-existing fallback, still fully
   supported for custom pi installs. PATH-resolved binaries keep the runtime
   version floor (≥ 0.80.6 for `agent_settled`); the provisioned binary
   satisfies it by construction.

Provisioning failures never block daemon start or session spawning: AO logs
the failure, falls back to PATH, and surfaces the state in
`GET /api/v1/system/requirements` (requirement id `pi-provisioning`),
including the fix hint. To retry, restart the daemon; to take manual control,
install pi yourself and point `AO_PI_BINARY` at it.

On a headless VM a PATH install is therefore optional. If you prefer your own
pi (e.g. installed via npm so `pi`/`node` live on the service PATH), keep it
and set `AO_PI_BINARY` — otherwise AO downloads and manages the binary for
you and only needs network access to github.com at daemon start.

## Enable Connect Mobile (LAN bridge)

Headless hosts have no Electron UI. Use the CLI over loopback:

```bash
ao mobile enable
ao mobile status
```

`enable` prints the **connection password**. Every LAN client (Android app,
Mac/Windows desktop in remote mode) uses that password as
`Authorization: Bearer <password>` on REST, SSE, and the `/mux` WebSocket.

Print a pasteable pairing payload for desktop clients:

```bash
ao mobile pairing-code
ao mobile pairing-code --json   # structured output including v2 endpoints
```

Persisted bridge state survives daemon restarts (`~/.ao/mobile/config.json`).

Background: [adr/0001-lan-listener-for-mobile.md](adr/0001-lan-listener-for-mobile.md).

## Register projects on the VM

Project paths and credentials are **VM-local**. The Mac/Windows file pickers
point at the client machine, so remote mode hides **Import an existing project**
and **Import a workspace folder**. **Create a new Git repository** uses `gh` on
the VM (`gh auth login` or `AO_GITHUB_TOKEN`), defaults to private, and checks
the repo out under `~/projects`. If create fails, run `gh auth status` **on
the VM as the daemon user** and add `read:org` with
`gh auth refresh -h github.com -s repo,read:org,workflow`, then restart
`ao-daemon`. **Clone from Git** posts to the daemon and
checks out under `~/` on the VM — remote mode does not open a Mac/Windows
folder picker. Prefer SSH for existing checkouts:

```bash
ao project add /path/to/your/repo
ao project ls
```

Clone or mount repositories on the VM before registering them.

## Pair clients

### Android

Settings → Connect Mobile on a **local** desktop is not available on a headless
host; use `ao mobile pairing-code` output or scan a QR generated from that
payload. See [packages/mobile/README.md](../packages/mobile/README.md).

### Mac / Windows desktop

Settings → **General** → **AO server** → **This network**. Paste the pairing
code from `ao mobile pairing-code`, or enter host, port, and password manually.
The desktop probes `GET /api/v1/identity` before sending the password, then
attaches without starting a local daemon.

Pairing payloads in the v2 format from `ao mobile pairing-code --json` carry
multiple endpoints; the desktop picks the first reachable one by kind
preference `lan` → `tailscale` → `tunnel` → `relay`. Older v1 payloads (single
host/port) and manual host/port/password entry still work. The connection is
stored as `desktop-remote.json` under `~/.ao/electron`.

In remote mode only the app API is reachable over the authenticated LAN
listener: sessions, terminal (`/mux`), events, and projects. Loopback-gated
routes (`/shutdown`, telemetry, mobile control) are never served remotely. See
[architecture.md](architecture.md) for the listener model and
[cli/README.md](cli/README.md) for `ao mobile` commands.

Switch back to **This computer** to run agents locally again.

## Pi on the VM

AO **spawns and supervises** Pi sessions; it does not attach to a Pi process you
started separately. Install `pi` on the VM, then spawn a worker with harness
**Pi**. Pi runs in its own terminal TUI; chat-mode (pi-acp) integration was
removed by #39 — see [harnesses/pi.md](harnesses/pi.md).

## Limitations on LAN clients

The LAN listener intentionally blocks loopback-only routes. Remote desktops
**cannot**:

- Drive the in-app **Browser** panel (removed by #39)
- Manage **Codex accounts** or install harnesses onto the VM from Settings
- Enable or disable **Connect Mobile** (run `ao mobile` on the VM instead)

Install agents and enable the LAN bridge over SSH on the VM. Use terminal
sessions, PRs, notifications, and terminals normally.

## Security notes

- Plaintext HTTP on a home LAN only — same posture as Connect Mobile.
- Rotate the password with `ao mobile regenerate` if it leaks.
- Keep the VM and LAN listener off untrusted networks.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Clients cannot connect | `ao mobile status`, VM firewall allows LAN port (default 3011) |
| Wrong machine answered | Identity probe failed — verify host id matches paired machine |
| `tmux` missing in doctor | Install tmux on the VM; TUI sessions require it on Linux |
| Pi spawn fails / UI shows preparing then session not found | The daemon rolled the session back. Interactive `pi --version` is not the daemon's PATH. `journalctl --user -u ao-daemon.service` will show `probe pi --version: exit status 127` when the Pi npm shim cannot find `node`. Put `pi` and `node` on the unit `Environment=PATH=…`, `daemon-reload`, restart. |
| Clone of private repos works, create-repo says `gh` is not authenticated | Expected. Clone is `git` + `~/.ssh`. Create is `gh repo create` and needs a GitHub API token in the **daemon** process. An SSH `gh auth status` can look fine because `.bashrc` exported `GH_TOKEN`. Check with `systemd-run --user --pty gh auth status`, then `gh auth login` (or `Environment=AO_GITHUB_TOKEN=…`) and `gh auth refresh -h github.com -s repo,read:org,workflow`, then restart `ao-daemon`. |
| Terminal stuck on “disconnected — reattaching” after a 201 spawn | The session exists; the desktop `/mux` WebSocket is failing LAN auth. Chromium reports that handshake as `ws://host:port/mux`, and a 401 from `authMiddleware` never reaches the chi `http request` logger — so journalctl stays quiet. A desktop build that injects the bearer token on `ws://` (not just `http://`) is required. Confirm `tmux` is on the daemon PATH as well. |

For CLI reference see [cli/README.md](cli/README.md).
