---
name: orchestrate
description: Use when directing AO worker sessions — briefing workers, monitoring progress, recovering stalled sessions, and gating PR merges. Loads the orchestration runbook for worker execution discipline and the stall escalation ladder.
---

# Orchestrate

Guidance for orchestrator sessions that spawn and supervise AO worker sessions.
This skill is a thin dispatcher: the full runbook lives in
[docs/orchestration.md](../../../docs/orchestration.md) — **load it first** and
follow it. Do not duplicate the runbook here; reference it.

## Worker briefs

Every worker brief contains, in this order:

1. **Task** — the issue or explicit task statement, with the scope boundary
   (what is explicitly out of scope).
2. **Pointers** — the docs and entry points to read first (start from the
   repo's `AGENTS.md` "Where to look first" list).
3. **Constraints** — repo hard rules and boundaries that apply to this task.
4. **Verification bar** — the narrow checks that define "done" for this change
   (which commands, which packages).
5. **Push discipline** — commit per chunk, open a draft PR early, flip ready
   only when all checks are green. CI is the authority: one full local
   verification pass, then push.
6. **Never stash** — `git stash` is forbidden in session worktrees (`refs/stash`
   is shared across concurrent sessions, issue #7).
7. **CI authority** — do not iterate via local full-suite loops; do not chase
   pre-existing failures (reproduce on pristine main first, note flakes in the
   PR body).

The details and rationale for items 5–7 are the runbook's "Worker execution
discipline" section — read it rather than improvising a variant.

## Stalled sessions

When a worker session stops responding, follow the runbook's stall playbook:
recognize the stall signature (`working` with no activity for 45+ minutes,
typically a large uncommitted worktree), detect it (session-watch when #14
ships; `ao session ls`/`get` polling or a host cron watcher today), then apply
the escalation ladder in order:

1. Status nudge — ask for a reply or a push.
2. Ten-minute ultimatum — commit and push + draft PR within 10 minutes,
   **commit first, then reply** with the blocker.
3. Kill and salvage — preserve the worktree diff (salvaged-WIP pattern) and
   respawn a worker onto it with a tight budget.

Governing rule: work is never hostage to a dead process.

## Merge gates

Before merging a worker's PR, require **all** of:

- **CI green** on the PR head — local test runs reported by the worker are not
  a substitute.
- **Keep-list verification via the PR files API** — review the changed-file
  list (`gh api repos/…/pulls/<n>/files`) and confirm every file is expected
  for the task's scope. Unlisted or generated files (build outputs, local run
  state, credentials) are a rejection, not a follow-up.
- **One PR per issue** — a PR that mixes issues gets split before merge.

## Out of scope

Decomposition, parallelization, and merge policy (wave scheduling, how many
workers per task) are **intentionally not codified yet** — see
[#51](https://github.com/ercs-second-brain/agent-orchestrator/issues/51). Until
they are, decide those case by case; do not treat this skill or the runbook as
authority on them.
