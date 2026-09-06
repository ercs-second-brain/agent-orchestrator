# N2 finish plan (continuing PR #59)

## State on arrival
- Backend: build green, `go test ./...` green. Schema regen stale (spec has 25-value reviewer enum).
- Frontend: typecheck green after 1-line fix (unused `vi`); vitest 62 failures / 13 files.
- Live stragglers found: agentauth plans (all 25), systeminstall agent targets (all 25),
  modelcatalog (non-pi commandSpecs/config parsers), dto.go + domain/session.go enum tags,
  UsageHookMetadata dead API surface, AO_AGENT validated at boot (rejects non-pi), doc examples.

## Chunk 1 — backend pi-only vocab (commit)
1. modelcatalog → pi-only (drop claude-code/muse/codex/cline discoverers, non-pi commandSpecs,
   config.go parsers; Discoverer loses Codex/Cline fields).
2. agentauth → pi-only plan; systeminstall → pi-only agent target (keep tmux/gh/claude/cloudflared).
3. Enum tags → pi: domain/session.go ReviewerHarness; dto.go SpawnSessionRequest.Harness,
   SetSessionReviewerRequest.Harness, DelegateTaskRequest.Agent, TriggerReviewRequest.Harness.
   Remove dead SetActivityRequest.Usage + UsageHookMetadata + specgen schemaNames entry.
4. config: doc default pi; AO_AGENT non-pi → pi (store-and-ignore; boot never fails on legacy value).
5. Comment/flag example fixes (cli/project.go, cli/hooks.go, ports, skillassets, review.go).
6. npm run api; go build/test/vet; commit openapi.yaml + schema.ts together.

## Chunk 2 — config normalization (ADR Q6 store-and-ignore) + sweep surfaces
- Spawn resolution coerces non-pi harness → pi (fake stays test-fixture) in session manager
  (effectiveHarness) and manager spawn validation; readiness checks resolve to pi.
- ProjectConfig.Validate stops rejecting non-pi role/reviewer harness values (preserved, ignored);
  ResolveReviewerHarness + SetReviewerHarness coerce non-pi → pi.
- Tests: store-and-ignore behavior (claude-code configured project spawns pi; legacy AO_AGENT boots).

## Chunk 3 — frontend deletion tail
- Remove AgentSwitchSummary/activeAgentSwitch, agent-switch-visibility, switch tests/surfaces.
- Fix 62 vitest failures file by file (delete tests for removed multi-agent UX; fix fixtures).
- Non-pi sessions render read-only.

## Chunk 4 — final verification
- go build/test/vet, frontend typecheck + vitest, api-drift; grep gates; push per chunk; PR body update.
