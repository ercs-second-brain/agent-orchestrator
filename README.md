<div align="center">
  <img src="assets/ao-logo.svg" alt="Agent Orchestrator" width="144" height="144" />

### Agent Orchestrator

#### Plan, run, and supervise coding agents from one place.

[![GitHub release](https://img.shields.io/github/v/release/ercs-second-brain/agent-orchestrator?style=flat&logo=github)](https://github.com/ercs-second-brain/agent-orchestrator/releases/latest)
[![GitHub downloads](https://img.shields.io/github/downloads/ercs-second-brain/agent-orchestrator/total?style=flat&logo=github)](https://github.com/ercs-second-brain/agent-orchestrator/releases)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat)](LICENSE)

Give every coding task its own agent, workspace, and feedback loop.<br />
Plan and delegate larger outcomes with a project-aware orchestrator.<br />
Follow every worker, pull request, CI run, and review in a live Kanban.

[**Download AO**](#install) &nbsp;&bull;&nbsp; [Documentation](docs/README.md) &nbsp;&bull;&nbsp; [Releases](https://github.com/ercs-second-brain/agent-orchestrator/releases) &nbsp;&bull;&nbsp; [Contributing](CONTRIBUTING.md)

<br />

<img src="docs/assets/readme/hero.png" alt="Agent Orchestrator Kanban showing worker sessions grouped by live status" width="100%" />
</div>

## A workspace for agent-driven development

One coding agent can handle a task. Running several across a project creates a different job: deciding what matters, splitting work cleanly, giving each agent the right context, preventing branch collisions, and following every change through review and merge.

AO is a local desktop workspace built for that job. Add a repository and create a worker session with the agent and model that fit the task. For Git-backed work, AO gives the worker its own branch and worktree. The task, terminal, changed files, pull request, CI, and review state stay attached to that session from start to finish.

Behind the desktop app, AO's local daemon watches agent activity and source-control state. The result is a shared, live view of the project instead of a collection of disconnected terminals and branches.

## Install

Download the latest AO desktop app for your platform. AO checks for updates automatically.

| Platform              | Download                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| macOS (Apple silicon) | [Download](https://github.com/ercs-second-brain/agent-orchestrator/releases/latest/download/agent-orchestrator-darwin-arm64.dmg)   |
| macOS (Intel)         | [Download](https://github.com/ercs-second-brain/agent-orchestrator/releases/latest/download/agent-orchestrator-darwin-x64.dmg)     |
| Windows               | [Download](https://github.com/ercs-second-brain/agent-orchestrator/releases/latest/download/agent-orchestrator-win32-x64.exe)      |
| Linux (AppImage)      | [Download](https://github.com/ercs-second-brain/agent-orchestrator/releases/latest/download/agent-orchestrator-linux-x64.AppImage) |
| Linux (Debian/Ubuntu) | [Download](https://github.com/ercs-second-brain/agent-orchestrator/releases/latest/download/agent-orchestrator-linux-x64.deb)      |
| Linux (Fedora/RHEL)   | [Download](https://github.com/ercs-second-brain/agent-orchestrator/releases/latest/download/agent-orchestrator-linux-x64.rpm)      |

Open Agent Orchestrator and point it at the repository you want AO to manage. The desktop app runs the daemon for you, so no CLI is required. The app and `ao start` check this repository's GitHub Releases for updates. See [docs/development.md](docs/development.md) for agent CLI setup and local builds.

<img src="docs/assets/readme/tui.png" alt="Agent Orchestrator workspace showing a coding agent's native terminal UI" width="100%" />

## Workers execute focused tasks

A worker is AO's unit of execution: one task, one coding agent, and one isolated workspace. Use **New task** when the work is already clear. Describe the outcome, choose an agent and model, attach relevant files, and work with the agent in its native terminal UI.

Open a worker at any time to attach to its terminal, inspect its changes, review its pull request, or send CI and review feedback back to the same agent. This makes each task independently understandable and keeps parallel work from collapsing into one shared context.

<img src="docs/assets/readme/new-task.png" alt="Create a new task in Agent Orchestrator with an agent and model selected" width="100%" />

## The orchestrator plans across the project

The project orchestrator is AO's persistent planning and coordination agent. It works at the level above individual tasks: the product direction, technical strategy, priorities, and sequence of work across the repository.

Use the orchestrator to explore an idea before implementation, brainstorm product and technical approaches, reason through tradeoffs, identify high-impact work, and turn an ambiguous outcome into a concrete plan. Its project-scoped conversation preserves goals, decisions, constraints, and earlier reasoning. It combines that planning history with repository context and live AO state, including active workers, ownership, pull requests, CI, and reviews. This keeps planning grounded in both the project and the work already underway.

When a plan becomes actionable, the orchestrator can break it into focused tasks, spawn or redirect workers, pass each worker the relevant context, follow their progress, and coordinate follow-up work. The orchestrator owns planning and delegation; workers own implementation, tests, commits, and pull requests.

<img src="docs/assets/readme/orchestrator.png" alt="Agent Orchestrator coordinating multiple workers and passing them focused project context" width="100%" />

## The Kanban keeps the system legible

Every worker appears on the same live board, whether you started it from **New task** or the orchestrator delegated it. AO derives each card's position from session, pull request, CI, and review facts, turning the Kanban into an operational view of the project:

- **Working:** workers that are actively implementing or ready for another instruction
- **Needs you:** blocked sessions, missing input, failed CI, requested changes, or lost signals
- **In review:** open and draft pull requests waiting on checks or review
- **Ready to merge:** approved or mergeable work, with merged sessions kept visible until they are archived

Each card keeps the task, agent, branch, activity, pull request, and status together. Open it to inspect the terminal, changed files, PR summary, and reviews. The board shows what is moving, what is blocked, and where your attention will have the most impact.

<img src="docs/assets/readme/hero.png" alt="Agent Orchestrator Kanban showing worker sessions grouped by live status" width="100%" />

## One workflow, from idea to merge

1. **Start at the right level.** Give a clear task directly to a worker, or develop a larger outcome with the project orchestrator and let it shape the plan.
2. **Delegate focused work.** Start workers yourself or have the orchestrator create them with the context and ownership they need.
3. **Build in isolation.** Every Git-backed worker gets its own branch and worktree; Scratch workers get AO-managed branchless directories.
4. **Supervise live state.** AO follows agent activity, pull requests, CI, review feedback, and merge conflicts, then reflects those facts on the Kanban.
5. **Close the feedback loop.** Inspect any worker directly, make project-level decisions with the orchestrator, and return actionable failures or review comments to the agent that owns the work.

AO works with the coding agents and source-control workflow you already use. Agents keep their native strengths; AO supplies the project context, isolated execution, coordination, and operational view that make them work as a system.

## Product highlights

<table>
  <tr>
    <td width="36%" valign="middle">
      <h3>Pull requests and agent reviews</h3>
      <p>Keep CI, mergeability, reviewer state, and interactive agent reviews beside the worker, then return requested changes to the same owner.</p>
    </td>
    <td width="64%">
      <img src="docs/assets/readme/review.png" alt="Worker session with pull request, CI, and agent review state in Agent Orchestrator" width="100%" />
    </td>
  </tr>
  <tr>
    <td width="36%" valign="middle">
      <h3>Native terminal UI, one supervisor</h3>
      <p>Agents run in their own terminal UI inside an AO-managed tmux session, while AO keeps task context, workspace state, and feedback in one place.</p>
    </td>
    <td width="64%">
      <img src="docs/assets/readme/tui.png" alt="Agent terminal interface supervised inside Agent Orchestrator" width="100%" />
    </td>
  </tr>
</table>

## Supported agent

**[Pi](docs/harnesses/pi.md) is AO's supported agent.** AO spawns the `pi` executable inside a managed tmux session and supervises it through the daemon's terminal mux — desktop, mobile, and CLI all attach to the same live terminal. The multi-agent adapter surface is being consolidated onto pi; see [ADR 0005](docs/adr/0005-single-agent-consolidation.md) for the decision and its rationale.

## Report a bug

File a GitHub issue with what happened, where, when, OS, AO version, and steps to reproduce. You can also ask a coding agent to follow [`.agents/skills/bug-triage/SKILL.md`](.agents/skills/bug-triage/SKILL.md).

```text
Read and follow .agents/skills/bug-triage/SKILL.md. Please reproduce and triage this bug, then file or update the GitHub issue. Context: <what happened, where, when, reproduction steps, OS, AO version, and frequency>.
```

## Develop and contribute

```bash
git clone https://github.com/ercs-second-brain/agent-orchestrator.git
cd agent-orchestrator
```

Start with the [development guide](docs/development.md) for prerequisites, local setup, and test commands. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and use [GitHub Issues](https://github.com/ercs-second-brain/agent-orchestrator/issues) for bugs and feature requests.

## Documentation

| Document                                                         | Start here when you need                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [docs/README.md](docs/README.md)                                 | Docs index.                                                                                  |
| [docs/release-repo.md](docs/release-repo.md)                     | Where updates come from and how to cut a release.                                            |
| [docs/architecture.md](docs/architecture.md)                     | Backend mental model, lifecycle, persistence, CDC, status derivation, and daemon boundaries. |
| [docs/backend-code-structure.md](docs/backend-code-structure.md) | Package ownership and where each backend concern belongs.                                    |
| [docs/cli/README.md](docs/cli/README.md)                         | CLI behavior and daemon route mapping.                                                       |
| [docs/development.md](docs/development.md)                       | Prerequisites, build steps, running tests, and troubleshooting for local development.        |
| [docs/STATUS.md](docs/STATUS.md)                                 | What currently ships on `main` and what remains in flight.                                   |

## License

Agent Orchestrator is available under the [Apache License 2.0](LICENSE).
