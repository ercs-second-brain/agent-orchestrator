# agent-orchestrator docs

The agent-orchestrator is a long-running Go backend daemon (`backend/`) plus an
Electron + TypeScript frontend (`frontend/`). The backend supervises coding-agent
sessions and exposes daemon control, project/session state, terminal streaming,
and CDC/event infrastructure.

Start with [architecture.md](architecture.md) for the current backend model and
[cli/README.md](cli/README.md) for the CLI surface.

## Reference docs

| Doc                                                    | What it covers                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                     | Current backend model, package layout, status derivation, persistence/CDC, and load-bearing rules.                    |
| [scm-observer.md](scm-observer.md)                     | SCM subsystem: polling pipeline, durable-state invariants, PR identity model, and the rename/transfer design.         |
| [backend-code-structure.md](backend-code-structure.md) | Package ownership rules for the Go backend: domain, services, ports, adapters, storage, HTTP, CLI, and daemon wiring. |
| [cli/README.md](cli/README.md)                         | CLI commands and daemon control surface.                                                                              |
| [headless-vm.md](headless-vm.md)                       | Run AO on a Linux VM (systemd, Connect Mobile, Pi) and attach Mac/Windows/Android clients over LAN.                   |
| [development.md](development.md)                       | Prerequisites, build steps, running tests, and troubleshooting for local development.                                 |
| [STATUS.md](STATUS.md)                                 | What is shipped on `main` today and what is still in flight.                                                          |
| [stack.md](stack.md)                                   | Accepted library/runtime choices, pending stack decisions, and dependencies explicitly avoided for V1.                |
| [release-repo.md](release-repo.md)                     | GitHub repo the updater and `ao start` use, and how the three URL sources stay in sync.                               |
| [telemetry.md](telemetry.md)                           | Remote telemetry is off; local diagnostics stay on-device unless a key is set.                                        |
| [daemon-environment.md](daemon-environment.md)         | Proposed fix for the GUI-launch PATH/credentials problem when the desktop app spawns the daemon.                      |

## Guides and runbooks

| Doc                                                          | What it covers                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [harnesses/pi.md](harnesses/pi.md)                           | Pi support: TUI spawning via the `pi` executable. Chat-mode (pi-acp) integration was removed by #39.          |
| [harnesses/omp.md](harnesses/omp.md)                         | OMP support as an interactive Terminal UI harness. (Its former Chat-mode section is removed by #39.)          |
| [runbooks/agent-switch-failure-points.md](runbooks/agent-switch-failure-points.md) | Failure-point runbook for the staged agent-switch production stream, with release gates.             |

## Decision records

Architecture decision records live in [adr/](adr/) and are permanent history:

- [adr/0001-lan-listener-for-mobile.md](adr/0001-lan-listener-for-mobile.md) — opt-in LAN listener for the Connect Mobile feature
- [adr/0002-secure-interactive-reviewer-gateway.md](adr/0002-secure-interactive-reviewer-gateway.md) — secure interactive reviewer gateway
- [adr/0003-persistent-chat-provider-host.md](adr/0003-persistent-chat-provider-host.md) — persistent chat provider host
- [adr/0003-unauthenticated-identity-probe.md](adr/0003-unauthenticated-identity-probe.md) — unauthenticated identity probe on the LAN listener
- [adr/0004-cloudflare-tunnel-for-remote-mobile-access.md](adr/0004-cloudflare-tunnel-for-remote-mobile-access.md) — Cloudflare Tunnel for remote mobile access

## Mental model

Persist durable facts, derive display status:

- session table: `activity_state`, `is_terminated`, identity, metadata
- PR tables: PR/CI/review facts
- derived read model: `service.Session` computes display status from session + PR facts
