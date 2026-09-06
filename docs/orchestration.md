# Orchestration runbook

Operational practices for directing AO worker sessions: how workers execute
tasks, and how an orchestrator recovers a stalled session. This runbook
codifies what has proven to work during the cleanup program; it is deliberately
scoped to **worker execution discipline**, the **stall playbook**, and context
exhaustion. Decomposition, wave scheduling, parallelization, and merge policy
are intentionally **not** codified yet (see
[#51](https://github.com/ercs-second-brain/agent-orchestrator/issues/51)).

Orchestrator sessions should load
[`.agents/skills/orchestrate/SKILL.md`](../.agents/skills/orchestrate/SKILL.md),
which references this runbook rather than duplicating it.

## Worker execution discipline

Stable policy every worker session follows. These rules exist so that work is
always recoverable and CI, not a local machine, decides whether a change is
done.

### Push early, commit per chunk

- Never sit on large uncommitted work. Commit each coherent chunk as it
  completes — WIP commits are checkpoints, not a claim of correctness.
- Open a **draft PR** as soon as the branch exists and has at least one commit.
  The draft PR is the durable checkpoint: it carries the work off the machine
  and makes progress visible before the change is ready.
- A WIP commit or draft PR is never an embarrassment; a large uncommitted
  worktree on a dead session is.

### Never use `git stash` in session worktrees

`refs/stash` is a single ref shared by every worktree of the repository, so
concurrent AO sessions can steal, overwrite, or lose each other's stashes (see
[#7](https://github.com/ercs-second-brain/agent-orchestrator/issues/7)). There
is no safe stash workflow in a session worktree. Commit instead — a WIP commit
on a session branch is strictly safer.

### CI is the authority

- Run **one** full local verification pass over the touched area (build, tests,
  typecheck — the narrow checks from `AGENTS.md`), then push. Do not iterate
  against the full local suite in a loop; repeated full runs burn time CI would
  settle faster.
- Do not chase pre-existing failures. Before attributing a failure to your
  change, reproduce it on pristine `main`. If it fails there too, it is not
  yours: note the unrelated failure or flake in the PR body and move on.
- A draft PR is for WIP. **Flip it ready only when all checks are green** (or
  when every remaining red is a pre-existing failure documented in the PR
  body).

### Hermetic test bar

Per [#47](https://github.com/ercs-second-brain/agent-orchestrator/issues/47):

- Tests must pass on a machine with nothing installed beyond the repo's dev
  dependencies. Verify the environment once with `node scripts/doctor.mjs`
  before starting work.
- Optional capabilities (missing binaries, unavailable services, platform
  specifics) must **skip with an explicit reason**, never fail.
- If a test fails on a doctor-green machine, suspect the test or the code — not
  the machine.

## Stall playbook

Proven recovery procedure for a worker session that has stopped making
progress. Governing rule: **work is never hostage to a dead process.** The
discipline section above is what makes recovery cheap — commit at checkpoints
so salvage is always possible.

### Stall signature

A worker session reports `working` but has shown no activity or transcript
update for **45+ minutes**, typically while sitting on a large uncommitted
worktree. 45+ minutes of silence — especially on a dirty worktree — is the stall signature to act on.

### Detection

- **Future, native:** session-watch events, the sensor capability tracked in
  [#14](https://github.com/ercs-second-brain/agent-orchestrator/issues/14),
  which will surface stalls without polling.
- **Today, interim:** poll `ao session ls` / `ao session get` from the
  orchestrator, or a host-level cron watcher script that checks the same
  session state periodically and flags sessions with stale activity. This
  interim method is documented here until #14 ships; it requires no daemon
  changes.

### Escalation ladder

Escalate one rung at a time; do not skip to the kill except when the process is
provably dead.

1. **Status nudge.** Send the session a message asking for a status reply or a
   push. Any response (or a new commit) clears the stall.
2. **Ten-minute ultimatum.** No reply? Send a second message: commit and push
   everything and open/update a draft PR within 10 minutes, and reply with the
   blocker. The order is fixed — **commit first, then reply** — so the work is
   safe even if the process dies mid-reply.
3. **Kill and salvage.** Still nothing after the ultimatum window: terminate
   the session and apply the **salvaged-WIP pattern**:
   - Preserve the worktree state as-is (the uncommitted diff *is* the salvage);
     commit it to the session branch or a salvage branch — do not discard it.
   - Respawn a fresh worker onto the salvaged state, with a **tight budget**
     (small scope, short deadline) so the replacement cannot stall the same
     way.
   - Note in the new brief what the previous session was doing and where it
     stopped.

The salvaged-WIP pattern exists because checkpoints are cheap: a session that
committed per chunk loses minutes of work at worst, not hours.

## Context exhaustion

A related but distinct failure mode from the inactivity stall: an **exhausted
context**. The worker stays active and productive right up to the moment it
dies — no 45-minute silence, no stalled transcript. Its context window simply
fills, it starts to loop, and then the session dies with its accumulated
knowledge gone. Because the stall playbook's detection never fires, context
death needs its own detection and playbook.

Evidence: during the cleanup program, an N2 deletion worker (~447 files, the
largest deletion of the program) ran to ~500k tokens, entered a loop, and died
holding 40 files of uncommitted work. Recovery required manual salvage plus a
continuation session re-briefed from inventory. Native context visibility and
auto-handoff are tracked in
[#64](https://github.com/ercs-second-brain/agent-orchestrator/issues/64); the
worker-facing policy text it becomes part of is
[#60](https://github.com/ercs-second-brain/agent-orchestrator/issues/60).
Until #64 ships, the thresholds and detection below are interim and
orchestrator-enforced.

### Thresholds

Interim thresholds, enforced by the orchestrator until #64 ships native
support:

- **~250k tokens of live context** — send the worker a structured
  **PREPARE-HANDOFF** directive (below).
- **~300k tokens** — **force-salvage**: kill the session and respawn a
  continuation briefed from the handoff report.

### Detection (interim)

Read the tail usage event from the session's pi JSONL: `input + cacheRead` of
the last assistant event is the live context size. The product feature — an
`ao session context` command and a dashboard context column — is
[#64](https://github.com/ercs-second-brain/agent-orchestrator/issues/64).

### PREPARE-HANDOFF directive

Send the worker this exact text:

> FIRST write a handoff report covering (a) exact position across task
> layers, (b) PR CI state per check with diagnosis, (c) design decisions the
> next session cannot infer, (d) non-obvious judgment calls, (e)
> grep-gate/verification status, (f) prioritized remaining-work list with
> file pointers, (g) half-done WIP and its intended end state. THEN finish
> only the current atomic unit (complete or document the broken state — never
> start new scope). THEN commit everything and push. Reply HANDOFF COMPLETE.
> Imperfect committed state with a written report beats a perfect tree with no
> report.

The report comes FIRST, before any further work — that ordering is the
directive's whole point.

### FORCE-SALVAGE procedure

If the worker dies or does not reach HANDOFF COMPLETE by ~300k tokens:

1. **Preserve refs.** Salvage-commit the worktree diff (the salvaged-WIP
   pattern from the stall playbook), then rebase it onto the branch's remote
   state. If the dying session left a stuck rebase in the worktree, remove the
   worktree's `rebase-merge` directory first.
2. **Push** to the PR branch.
3. **Kill** the session.
4. **Respawn** a continuation briefed from the handoff report, the PR state,
   and the original task — with a tight budget and the worker execution
   discipline restated as lived experience.

### Worker-facing note

If your orchestrator sends you a prepare-handoff directive, the handoff
report comes FIRST, before any further work.
