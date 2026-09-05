# 5. Single-agent consolidation: pi as a managed external dependency, retire the adapter zoo

Date: 2026-09-05 (revised 2026-09-05: vendored-import decision replaced by managed external dependency)
Status: Accepted (revision 2). Milestone N3's chat-driver plan is superseded by
[#39](https://github.com/ercs-second-brain/agent-orchestrator/issues/39) — see
the SUPERSEDED note in section 4.

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

The pi coding agent
([`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi),
packages/coding-agent in a monorepo, MIT, authored by Mario Zechner) is an
**external binary**:

- The Go adapter (`adapters/agent/pi`) resolves `pi` from `PATH` or npm-global
  locations and enforces a version floor (≥ 0.80.6 for `agent_settled`).
- AO writes a generated workspace extension (`.pi/extensions/ao-activity.ts`,
  embedded as a Go string literal in `hooks.go`) and passes it explicitly with
  `--extension`; the extension reports lifecycle events by shelling out to
  `ao hooks pi <name>` with stdin JSON.
- Known gaps exist where AO worker sessions meet pi's extension behaviors
  (memory extraction wired to a shutdown event headless sessions never emit;
  self-improve assuming interactive UI surfaces). Those are **not** addressed
  by this ADR — see *Out of scope* below.

An earlier revision of this RFC proposed vendoring pi's TypeScript source
in-repo. That direction is withdrawn: the user chose not to couple this repo to
pi's fast-moving source tree, and the in-repo extension-API work it would have
unlocked is deferred. What remains — and what this ADR commits to — is the
single-agent deletion plus a proper dependency-management story for pi: AO
stops *probing* for pi and starts *provisioning* it.

## Decision

### 1. pi is a managed external dependency, pinned per AO release, auto-provisioned and auto-updated

Options considered:

**(a) Status quo: probe `PATH`/npm-global for whatever pi the user has.**
Rejected. Version floors (`minPiSettledVersion`) and PATH-repair shims exist
only because the binary's provenance is unknown; first-run installs fail when
pi is absent or too old, and capability switches stay runtime guesses.

**(b) Vendor pi's source in-repo.** Rejected (direction change). A fork of a
fast-moving upstream is a standing maintenance cost, and the joint
customization it would buy is deferred, not scheduled (see *Out of scope*).

**(c) Managed external dependency — the decision.** pi stays an external
binary, but AO treats it as a first-class, fully managed dependency:

- **Single supported agent.** pi is the only harness AO supports. Every other
  harness, adapter, picker, and flag is deleted (section 2).
- **Pinned per AO release.** Each AO release pins an exact pi version as a
  compile-time constant in the daemon. Capability switches collapse: when the
  pinned version is known at build time, `minPiSettledVersion`-style gates
  become compile-time facts per release, not runtime probes.
- **Auto-provisioned.** At desktop install / daemon first-run, AO downloads
  the pinned pi binary (from pi's GitHub releases or the npm tarball — open
  question 2), verifies its checksum, and stores it under the AO data
  directory (`~/.ao`, respecting `AO_DATA_DIR`), e.g. `~/.ao/bin/pi/<version>/`.
  Provisioning is idempotent and runs before any session spawn that needs it.
- **Auto-updated.** When the daemon/desktop app updates, the new release's
  pinned pi version is provisioned alongside the update, before the daemon
  starts spawning sessions against it.
- **PATH fallback stays.** If the user has their own pi install, it remains
  usable: explicit opt-in via config/env points AO at a user-provided binary,
  and `PATH` is the fallback when no managed binary is present. User-supplied
  binaries keep the runtime version floor, since their provenance is unknown.
- **Boundary unchanged.** The daemon still spawns a pi binary per session.
  Nothing about the process model moves; only the binary's provenance and
  version contract change. The CLI thin-client rule is unaffected.

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
the `codexops` gate (which exists only for Codex's device-global home). The
`piacp` driver and the generic ACP stack remain for now; replacing them with
pi's native `--mode rpc` behind the persistent chat host (ADR 0003) is a
separate future decision, not part of this ADR.

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
  one-time, daemon-start normalization (a new SQLite migration — never editing
  an already-merged one) rewrites non-`pi` values to `pi` and logs each
  rewrite. During the transition window before deletion, resolve-time
  defaulting applies: any harness value other than `pi` still resolves, but new
  projects default to `pi` and the pickers no longer offer alternatives.
- **Running sessions on other harnesses.** At the deletion wave (N2), a
  one-time cleanup sweep marks every non-pi *running* session terminated with
  an explicit reason (`harness-removed`), which settles activity state through
  the normal derived-status read path — never by faking durable facts. Those
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

### 4. Out of scope: the in-repo extension work (deferred)

The withdrawn vendoring direction would have enabled joint customization
inside pi's codebase. That work is **out of scope** for this ADR and is
deferred — the underlying needs are real, but the user chose not to couple
them to an in-repo fork:

- **Memory extraction on the turn gate.** Memory capture hooks
  `session_shutdown` (and only for `reason === "quit"`), which headless AO
  worker sessions effectively never produce — the daemon kills the process, so
  memory is silently lost today.
- **Self-improve headless mode.** Self-improve assumes interactive `ctx.ui`
  surfaces (select/confirm/input) that do not exist when pi runs headless
  under AO.
- **In-repo AO activity extension.** Moving the generated `.ts` string
  literal into a typechecked extension with headless lifecycle guarantees and
  a direct event channel to the daemon.
- **Chat via native RPC.** Replacing the third-party `pi-acp` wrapper with
  pi's native `--mode rpc` behind the persistent host (ADR 0003).
  **SUPERSEDED by #39 (2026-09): the chat concept itself was removed** — no
  chat driver of any kind survives, so there is no pi rpc chat driver to
  build. #39 also went further than the deletion wave below: the embedded
  browser runtime and preview server were removed with the chat stack.

These are candidates for a future ADR if and when the need outweighs the fork
cost. Nothing in this ADR's milestones depends on them.

### 5. Risks

- **Provisioning failures.** Auto-download introduces new failure modes at
  first-run and update time: no network, blocked corporate proxies, missing or
  checksum-mismatched release artifacts, unsupported platforms. Provisioning
  must fail loudly with a retry path, and the PATH fallback is the safety net
  when the managed binary cannot be obtained.
- **Pin staleness vs upstream speed.** pi moves fast (0.75 → 0.85 within the
  release window AO has tracked). A pinned version ages between AO releases;
  upstream security fixes in pi's provider stack reach users only when AO
  re-pins and ships. The re-pin cadence must be documented and cheap.
- **PATH-fallback divergence.** A user-supplied binary can be older or newer
  than the pin; the runtime version floor stays for that path, and behavior
  differences between managed and user binaries must stay within the
  capability switches the adapter already has.
- **Windows.** The downloaded artifact's Windows/ConPTY behavior needs
  verification before provisioning is declared complete on all three platforms
  (open question 3).
- **Sizing the diff.** The deletion itself is large but mechanical — ~47k lines
  of agent adapters, ~25 reviewer adapter packages, ~10 chatdrivers, the domain
  vocabulary, four CLI/HTTP inventory surfaces, and several thousand lines of
  frontend picker code — mostly reducible to compile errors and deleted tests.
  The genuinely risky work is small: the provisioning path (N1). Review effort
  should be allocated accordingly, not by line count.
- **API contract churn.** Removing `GET /api/v1/agents`, the `harness` field
  semantics, and `TriggerReviewRequest.harness` values are breaking wire
  changes; OpenAPI and `frontend/src/api/schema.ts` regenerate together, but
  any external consumer (mobile, scripts) must be checked.

### 6. Milestones

Sequenced against the cleanup program so waves that rename shared surfaces land
before deletion, minimizing conflicts. Each milestone is independently
shippable; **N1 ships before any deletion** so every user always has a working
pi.

| # | Milestone | Depends on | Notes |
| --- | --- | --- | --- |
| N1 | Provisioning: downloader with checksum verification, per-release version pin (compile-time constant), storage under `~/.ao` (`AO_DATA_DIR`-respecting), PATH fallback, update-on-app-update wiring | — | Purely additive; behavior unchanged for users who already have pi. Ships before deletions so every user has a working pi. |
| N2 | Deletion wave: non-pi agent/reviewer/chatdriver packages, registries, domain vocab, `codexops`, `agentlaunch`, agent inventory surfaces, CLI `-harness`, frontend pickers; one-time config normalization + running-session sweep | N1; cleanup waves #18 (cloud control-plane removal), #26 (owner purge), #15 (English-only) landed first — they touch shared files (workflows, module path, docs, frontend trees) the deletion also touches | One PR per layer (backend adapters → CLI/HTTP + schema regen → frontend → docs) to keep reviewable. OpenAPI/schema regen committed with Go changes. |
| N3 | Docs/stack rewrite: `docs/stack.md`/`architecture.md`/`AGENTS.md` single-agent model; `docs/harnesses/` collapsed to the pi runtime doc | N2 | Closes #13. |

## Consequences

- AO's agent surface is one harness. There is no registry to wire, no picker
  to update, no inventory to keep honest; agent behavior changes live in the
  single pi adapter and in pi upstream.
- First-run installs work without a pre-existing pi: AO provisions the pinned
  binary itself, checksum-verified, under `~/.ao`.
- The daemon still spawns an external binary. Pi upgrades between AO releases
  are a re-pin + release, not a code change — AO never carries a fork, and the
  in-repo extension payoff (headless memory extraction, self-improve headless)
  is explicitly deferred, not promised.
- Every non-pi harness stops working. This is the point, but it is a
  user-visible removal: users with `codex`- or `claude-code`-configured
  projects get migrated to pi (logged), and running non-pi sessions terminate
  at upgrade time with an explicit reason.
- The third-party `pi-acp` chat wrapper remains for now; replacing it is
  deferred alongside the other in-repo extension work.
- License posture: pi stays external (MIT, npm/GitHub releases); AO only
  redistributes release artifacts with checksum verification.

## Open Questions

1. **Pinning policy.** Exact version pin per AO release (reproducible,
   capability-known) vs caret-style range (auto-take minor fixes)? The current
   lean is exact-pin; what re-pin cadence keeps security fixes flowing?
2. **Download source and verification.** Pi's GitHub release artifacts vs the
   npm tarball (`@earendil-works/pi-coding-agent`)? Which ships per-platform
   binaries with checksums, and what is the canonical verification recipe
   (sha256 sums file, signed release)?
3. **Windows/ConPTY verification.** What test pass proves the downloaded
   artifact works under Windows ConPTY before provisioning is declared
   complete on all three platforms?
4. **Update transport.** Do pi updates ride the desktop updater (provisioned
   as part of the app update, same trust chain) or does the daemon poll for
   new pins independently? The lean is ride-the-updater; polling adds a
   second upgrade path to keep consistent.
5. **Fate of the in-repo extension ideas.** Parked for now. Should the
   memory turn-gate and self-improve headless gaps get their own RFC/ADR now
   (scoped to upstream contribution or a workspace-extension workaround), or
   wait until the deletion wave has settled?
