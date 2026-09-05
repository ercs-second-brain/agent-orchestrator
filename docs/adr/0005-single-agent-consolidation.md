# 5. Single-agent consolidation: absorb pi, retire the adapter zoo

Date: 2026-09-05
Status: Proposed (RFC for [#13](https://github.com/ercs-second-brain/agent-orchestrator/issues/13))

## Context

AO's backend carries a **multi-agent adapter layer** whose purpose is to normalize
many terminal coding agents behind one contract. Today that layer is:

- `backend/internal/adapters/agent/` — ~30 packages, ~47,000 lines of Go
  (2.2 MB): one adapter per harness (`claudecode`, `codex`, `cursor`, `aider`,
  `opencode`, `grok`, `droid`, `amp`, `agy`, `crush`, `qwen`, `copilot`,
  `goose`, `auggie`, `continue`, `devin`, `cline`, `kimi`, `kimchi`, `kilocode`,
  `kiro`, `muse`, `omp`, `primeagent`, `vibe`, `autohand`, …) plus shared
  plumbing (`agentbase`, `binaryutil`, `hookutil`, `activitydispatch`,
  `activitystate`, `authprobe`, `modelcatalog`, `nativeconfig`, `terminalui`).
- `backend/internal/adapters/reviewer/` — a second, near-duplicate set of
  ~25 reviewer adapters, each shipping harness-specific assets (e.g.
  `reviewer/pi/assets/ao-pi-reviewer.ts`).
- `backend/internal/adapters/chatdriver/` — per-harness Chat drivers
  (`claudeacp`, `codexappserver`, `cursoracp`, `droidacp`, `kimchiacp`,
  `kimiacp`, `nativeacp`, `ompacp`, `opencodeacp`, `piacp`) plus the generic
  ACP stack, wired through `chatdriver/registry`.
- Vocabulary and surfaces keyed to the harness set: `domain.ReviewerHarness`
  (25 constants), `domain.AgentHarness`, agent readiness/inventory
  (`GET/POST /api/v1/agents`, `ao agent`, frontend
  `agent-inventory-telemetry.ts`), auth/install plans in
  `service/agentauth` and `service/systeminstall`, the
  `agentlaunch` launch-environment helper, and the `codexops` gate that exists
  solely to serialize access to the device-global Codex home.
- User-facing choice surfaces: `cli/spawn.go -harness` / `--agent` (25 values in
  the usage string), `frontend/src/renderer/lib/agent-select-options.ts`,
  `agent-options.ts`, the `reviewer-harnesses.ts` union, and
  `CreateProjectAgentSheet.tsx` (566 lines of harness-picking UI).

Every added agent widens this surface: per-harness auth probes, packaging
plans, lint/gosec findings, capability switches, and UI pickers. Meanwhile the
orchestration value of that breadth is nearly zero: **pi is the harness AO
actually deploys** (activity hooks, TUI/Chat handoff intent, AO worker
sessions), and the adapter zoo's normalization is only ever exercised against
pi in practice.

The pi coding agent itself
([`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi),
packages/coding-agent in a monorepo, MIT, authored by Mario Zechner) is currently
an **external binary**:

- The Go adapter (`adapters/agent/pi`) resolves `pi` from `PATH` or npm-global
  locations and enforces a version floor (≥ 0.80.6 for `agent_settled`).
- AO writes a generated workspace extension (`.pi/extensions/ao-activity.ts`,
  embedded as a Go string literal in `hooks.go`) and passes it explicitly with
  `--extension`; the extension reports lifecycle events by shelling out to
  `ao hooks pi <name>` with stdin JSON.
- Chat mode runs through a *third-party* ACP wrapper,
  `@victor-software-house/pi-acp` (requires Bun, runs a background daemon, has
  no permission boundary — see `docs/harnesses/pi.md`), even though pi itself
  ships a native headless protocol (`pi --mode rpc`, JSONL over stdio).
- Headless AO worker sessions expose gaps in pi's extension behaviors that we
  cannot fix today: memory extraction is wired to `session_shutdown`, which
  never reliably fires for daemon-driven sessions, and self-improve's headless
  mode assumes interactive `ctx.ui` surfaces that do not exist headless.

Owning pi's code in this repository removes the upstream-release coordination
from every one of those fixes and lets the agent and the orchestrator evolve as
one codebase. This RFC records the import strategy, the deletion inventory, the
migration path, the joint-customization payoff, the risks, and the milestone
sequence. It is **design-only**: no code is removed or imported by this ADR.

## Decision

### 1. Import strategy: vendored TypeScript package under `pi/`, Go daemon unchanged in shape

Three options were considered:

**(a) `git subtree` of the whole `earendil-works/pi` monorepo.** Preserves
upstream history and makes future upstream pulls mechanical, but imports the
entire monorepo (docs site, examples, unrelated packages) and couples AO's CI to
upstream's layout. Pi upstream restructures frequently; subtree merges across a
repo whose internal packages move regularly would be high-churn.

**(b) Vendored package: copy `packages/coding-agent` (plus the sibling
`@earendil-works/*` packages it actually imports) into `pi/` in this repo,
without upstream git history, tracked in-tree.** This is the recommendation.
Details:

- Source of truth: `github.com/earendil-works/pi`, directory
  `packages/coding-agent`. The npm tarball ships only `dist/`; source must come
  from the GitHub repo (the npm package's `exports` already reference
  `src/*.ts` paths, so a dist-only vendor would leave a broken package).
- Vendored layout: `pi/` at the repo root with its own `package.json`,
  lockfile (`npm-shrinkwrap.json` carries pi's dependency tree), build script
  (esbuild bundle → `pi/dist/bundle/cli.js`, matching today's published
  artifact), and its own tests/lint. The 134 MB of `node_modules` is **not**
  vendored; CI and release builds install from the lockfile.
- Licensing: pi is **MIT**; vendoring with retained `LICENSE` and copyright
  notices is fully compatible. The vendored tree keeps upstream `LICENSE` and
  `CHANGELOG.md`, and `pi/README.md` gains a banner stating the fork point
  (upstream version + commit) and divergence policy.
- Monorepo siblings: pi imports `@earendil-works/pi-ai`, `pi-agent-core`,
  `pi-tui`, and friends. Those are vendored too, as sibling directories under
  `pi/` (mirroring upstream's workspace), because the extension API and RPC
  types that AO compiles against live across them. Sibling scope is decided at
  import time by following real imports, not by copying everything.

**(c) Go/TS boundary merge (rewriting the agent in Go, or the daemon in TS).**
Rejected. The Go daemon's process-control model is sound and the boundary
between it and the agent is already just "spawn a binary with flags and parse
JSON output". A language-level merge would be a multi-year rewrite with no
behavioral payoff and would put pi's TUI (Node/TS) on Go's terminal story.

**The retained architecture stays "the daemon spawns pi binaries"** — the
boundary does not move — but the binary AO spawns is now built from in-repo
source:

- Release builds produce the pi bundle from `pi/` and ship it with the desktop
  app (GitHub Releases per `docs/release-repo.md`); `ao start` and the daemon
  resolve the AO-shipped binary first, with `PATH` fallback during migration.
- The daemon-spawned-binary model loses its failure modes: the
  `pi --version` probe, the `minPiSettledVersion` capability switch, and the
  `AugmentRuntimePATHForLaunchBinary` PATH-repair shim all exist because the
  binary's provenance is unknown. When AO builds and pins the binary, version
  and capability are known at compile time.
- The CLI thin-client rule is unaffected: pi internals stay behind daemon HTTP
  routes; nothing about pi's internals leaks into `internal/cli`.

### 2. What gets deleted (the adapter zoo)

Deletion is a single mechanical wave, enumerated here so the diff can be sized
and reviewed honestly:

**Backend agent adapters** — delete every non-pi package under
`backend/internal/adapters/agent/`: `agy`, `aider`, `amp`, `auggie`,
`autohand`, `claudecode`, `cline`, `codex`, `continueagent`, `copilot`,
`crush`, `cursor`, `devin`, `droid`, `goose`, `grok`, `kilocode`, `kimchi`,
`kimi`, `kiro`, `muse`, `omp`, `opencode`, `primeagent`, `qwen`, `vibe`. Keep
`pi` and the shared plumbing (`agentbase`, `binaryutil`, `hookutil`,
`activitydispatch`, `activitystate`, `authprobe`, `modelcatalog`,
`nativeconfig`, `terminalui`, `fake` for tests) — these are harness-agnostic
and pi still uses them, though several will shrink or fold into the pi adapter
once they have a single caller.

**Reviewer adapters** — delete all of `backend/internal/adapters/reviewer/*`
except `pi` (and its `agentrestore` machinery), and collapse
`domain/reviewerharness.go` to `pi` only. The reviewer vocabulary survives as a
type (a reviewer is still a distinct role from a worker) but stops being a
25-value union.

**Chat drivers** — delete `claudeacp`, `codexappserver`, `cursoracp`,
`droidacp`, `kimchiacp`, `kimiacp`, `nativeacp`, `ompacp`, `opencodeacp`, and
the `codexops` gate (which exists only for Codex's device-global home). Whether
the generic ACP stack (`chatdriver/acp`) and `piacp` survive depends on Open
Question 3; the target end-state replaces the external `pi-acp` dependency with
pi's native `--mode rpc` behind the persistent chat host (ADR 0003), at which
point the ACP stack goes too.

**Inventory / launch plumbing** — `cli/agent.go` (`ao agent`), the
`GET/POST /api/v1/agents` controllers and readiness service surfaces (OpenAPI
regenerated per the API-contract rules), `agentlaunch` (its PATH-augmentation
job moves into the pi adapter/binary resolution), `codexops`, and the
per-harness auth/install plans in `service/agentauth` and
`service/systeminstall` that shrink to pi-only entries.

**CLI** — the `-harness` / `--agent` flags on `ao spawn` (`cli/spawn.go`),
including `resolveSpawnHarness` and `preflightSpawnAgentAuth`; spawning pi
becomes the only path, configured per project rather than per invocation.

**Frontend** — `agent-select-options.ts`, `agent-options.ts`, the
`reviewer-harnesses.ts` union, `CreateProjectAgentSheet.tsx`,
`agent-inventory-telemetry.ts`, the agent pickers inside `TaskComposer` and
`ProjectSettingsForm`, and the agent-switch presentation/visibility helpers.

**Docs** — `docs/harnesses/omp.md` deleted; `docs/harnesses/pi.md` rewritten as
the single-agent runtime doc; `docs/stack.md`, `docs/daemon-environment.md`, and
`AGENTS.md` conventions updated to the single-agent model.

### 3. Migration path for existing sessions and projects

Config and durable facts must keep meaning something after the vocabulary
collapses to one harness:

- **Project config.** `worker.agent`, `orchestrator.agent`, and reviewer
  harness fields hold stored values like `"claude-code"` or `"codex"`. A
  one-time, daemon-start normalization (not a merged SQLite migration — new
  migration instead) rewrites non-`pi` values to `pi` and logs each rewrite.
  Config *defaulting* during the transition window (Milestones M1–M3, before
  deletion) is resolve-time: any harness value other than `pi` still resolves,
  but new projects default to `pi` and the pickers no longer offer alternatives.
- **Running sessions on other harnesses.** At the deletion wave (M4), a
  one-time cleanup sweep marks every non-pi *running* session terminated with an
  explicit reason (`harness-removed`), which settles activity state through the
  normal derived-status read path — never by faking durable facts. Those
  sessions keep their history, terminal scrollback, and cost records; they
  simply cannot be relaunched. Their worktrees are left untouched: dirty
  worktrees are never force-deleted (existing hard rule); a follow-up
  `ao worktree prune` pass remains the user's explicit cleanup tool.
- **Terminal/Chat state.** Sessions store harness + native session ids as
  durable facts; resumability is already best-effort per harness. Non-pi
  sessions are displayed read-only; the UI drops harness-switch affordances
  rather than offering switches that cannot launch.
- **No config file rewrite outside the daemon.** The CLI never edits project
  config directly; normalization happens at daemon start so the change is
  observed once, atomically, and consistently for desktop and CLI.

### 4. Joint-customization payoff

This is the point of the whole exercise, so it is specified, not hand-waved:

- **Memory extraction at the turn gate.** Today memory capture hooks
  `session_shutdown` (and only for `reason === "quit"`), which headless AO
  worker sessions effectively never produce — the daemon kills the process, so
  memory is silently lost. With pi in-repo, memory extraction moves to a
  turn-gate event (`agent_settled` / post-turn), which headless sessions do
  emit, and the extension guarantees a final flush on SIGTERM. The observed
  breakage in AO worker sessions is the acceptance test for this change.
- **Self-improve headless mode.** Self-improve currently assumes interactive
  `ctx.ui` (select/confirm/input) that does not exist when pi runs headless
  under AO. The in-repo extension API gains a headless contract: UI requests
  become either structured events on the RPC stream (AO answers them) or
  explicit no-ops with logged reason, and self-improve is implemented against
  that contract.
- **Extension API once pi is in-repo.** AO's activity integration stops being
  a generated `.ts` string literal shelling out to `ao hooks` via `spawnSync`,
  and becomes: (a) AO extensions living in the `pi/` tree, typechecked against
  the in-repo `ExtensionAPI`, (b) guaranteed lifecycle events in headless/RPC
  mode (`session_start`, `before_agent_start`, `agent_end`, `agent_settled`,
  plus a documented termination flush), and (c) an in-process or direct-RPC
  event channel to the daemon replacing per-event subprocess spawns, with the
  5-second hook timeout becoming a daemon-side delivery guarantee instead of a
  client-side guess.
- **Chat for pi.** The native `--mode rpc` JSONL protocol replaces the
  third-party `pi-acp` wrapper (which pins Bun and runs its own background
  daemon), hosted per ADR 0003's persistent-host model. Owning both sides makes
  the TUI/Chat handoff (same durable conversation) a feasible in-repo feature
  instead of a documented impossibility.

### 5. Risks

- **Upstream divergence.** pi moves fast (0.75 → 0.85 within the release window
  AO has tracked) and is actively developed by its author for his own use. Once
  vendored, AO carries a fork: upstream improvements (providers, models, TUI
  fixes) must be ported by hand or via periodic re-syncs. This is the standing
  cost that replaces today's adapter-maintenance cost, and it should be
  periodically re-justified; if pi's fork cost ever exceeds the zoo's, the ADR
  gets revisited, not silently eroded.
- **Binary distribution.** Today pi arrives via npm and AO probes for it. After
  consolidation AO must build (esbuild bundle, ~21 MB `dist`) and distribute it:
  release artifacts per platform, Node ≥ 22.19 availability at runtime, and the
  updater path must carry it. "Bundled with the app" is the chosen end-state;
  the interim risk is the migration window where both npm-installed and
  AO-shipped binaries exist and the resolver order must be deterministic.
- **ACP / chatdriver contracts.** Replacing `pi-acp` with pi's native RPC mode
  rewrites pi's Chat path. ADR 0003's persistent-host guarantees (exclusive
  attachment, replay-on-detach, request high-water marks) must be re-proven
  against the RPC protocol, and the removal wave must not delete the ACP stack
  before the RPC driver passes the existing Chat test suites.
- **Sizing the diff.** The deletion itself is large but mechanical — ~47k lines
  of agent adapters, ~25 reviewer adapter packages, ~10 chatdrivers, the domain
  vocabulary, four CLI/HTTP inventory surfaces, and several thousand lines of
  frontend picker code — mostly reducible to compile errors and deleted tests.
  The genuinely risky work is small: the pi import/build wiring (M1), the
  RPC-based Chat driver (M3), and the extension-API changes (M2). Review effort
  should be allocated accordingly, not by line count.
- **API contract churn.** Removing `GET /api/v1/agents`, the `harness` field
  semantics, and `TriggerReviewRequest.harness` values are breaking wire
  changes; OpenAPI and `frontend/src/api/schema.ts` regenerate together, but
  any external consumer (mobile, scripts) must be checked — see Open
  Questions.

### 6. Milestones

Sequenced against the cleanup program so waves that rename shared surfaces land
before deletion, minimizing conflicts. Each milestone is independently shippable.

| # | Milestone | Depends on | Notes |
| --- | --- | --- | --- |
| M0 | Cleanup waves land: #16 landing removal, #18 cloud control-plane removal, #26 owner purge (`aoagents/` module path, URLs), #27 cost-catalog removal, #15 English-only | — | All five touch shared files (workflows, module path, docs, frontend trees) that the deletion wave also touches. **M4 must not start before M0 completes.** |
| M1 | Import pi under `pi/` (vendored, no code deletion elsewhere); CI builds the bundle; release workflow ships the pi binary; daemon resolver prefers the AO-shipped binary, PATH fallback stays | M0 preferred, not required | Purely additive; behavior unchanged. Establishes the fork-point banner and sync procedure. |
| M2 | Joint extension work in-repo: AO activity extension moves into `pi/`; headless lifecycle guarantees; memory extraction on turn-gate; self-improve headless mode | M1 | The payoff milestone; independently testable against AO worker sessions. |
| M3 | Chat: replace `pi-acp` with pi's native `--mode rpc` driver behind the persistent host (ADR 0003); delete the pi-acp/Bun prerequisite | M1 | Must pass existing Chat suites before `piacp` is removed. |
| M4 | Adapter removal wave: delete non-pi agent/reviewer/chatdriver packages, registries, domain vocab, `codexops`, `agentlaunch`, agent inventory surfaces, CLI `-harness`, frontend pickers; one-time config normalization + running-session sweep; collapse docs | M0, M1, M3 (M2 may land in parallel) | One PR per layer (backend adapters → CLI/HTTP → frontend → docs) to keep reviewable. OpenAPI/schema regen committed with Go changes. |
| M5 | Post-consolidation: `docs/stack.md`/`architecture.md`/`AGENTS.md` single-agent rewrite; delete `docs/harnesses/`; re-verify release/update path with bundled pi | M4 | Closes #13. |

## Consequences

- AO's agent surface is one harness. Adding agent behavior means editing
  `pi/` and the Go adapter together in one PR; there is no registry to wire,
  no picker to update, no inventory to keep honest.
- The external `pi-acp` dependency (and its Bun requirement) disappears; the
  third-party boundary at the agent runtime is gone entirely.
- Every non-pi harness stops working. This is the point, but it is a
  user-visible removal: users with `codex`- or `claude-code`-configured
  projects get silently migrated to pi (logged), and running non-pi sessions
  terminate at upgrade time with an explicit reason.
- AO assumes maintenance of a fast-moving fork. The fork-point banner, sync
  procedure, and re-justification cadence are part of the M1 deliverable, not
  an afterthought.
- License posture: MIT vendoring with retained notices; no new copyleft
  obligations introduced.
- The daemon's process model is unchanged: it still spawns an agent binary
  per session; only the binary's provenance and version contract change.

## Open Questions

1. **Subtree vs vendored copy.** The recommendation is vendored-without-history;
   if upstream syncs prove painful, a subtree re-import with history preserved
   is still possible later. Is manual sync acceptable, or should M1 include a
   scripted sync tool from day one?
2. **Monorepo sibling scope.** Exactly which `@earendil-works/*` siblings get
   vendored (follow imports), and do we vendor upstream's examples/docs at all?
3. **Wire contract breakage.** Do we keep `GET /api/v1/agents` as a
   single-entry list during the transition (cheap, keeps mobile working) or
   remove it outright at M4? Do the mobile clients reference harness ids
   anywhere that needs its own migration?
4. **TUI/Chat handoff.** With pi in-repo, is same-conversation handoff now a
   target feature (it was documented as impossible against external pi-acp)?
   If yes, it deserves its own ADR rather than riding this one.
5. **Windows.** pi's Windows/ConPTY behavior needs verification before the
   bundled-binary distribution is declared complete on all three platforms.
6. **Config erasure vs override.** The one-time normalization rewrites
   non-pi harness values to `pi` (lossy, simple). The alternative — keeping the
   original value stored but ignored — preserves user intent if they ever leave
   AO. Which does the cleanup PR implement?
7. **Fork governance.** Does AO carry pi version numbers in its own releases,
   and what is the documented policy for taking upstream security fixes in pi's
   provider stack?
