# Quick Reference

Natural-language-to-command mappings for common AO tasks.

| You want to... | Command |
|---|---|
| Spawn a worker on issue N | `ao spawn --project <p> --issue N --name "<=20 chars>" --prompt "..."` |
| Message a running agent | `ao send --session <id> --message "..."` |
| Kill a session | `ao session kill <id>` |
| List sessions | `ao session ls` |
| Register a repo as a project | `ao project add --path <abs-path> --name <name>` |
| List projects | `ao project ls` |
| Rename a session | `ao session rename <id> "<name>"` |
| Restore a killed session | `ao session restore <id>` |
| Clean up terminated sessions | `ao session cleanup` |
| Make a Docker container this session starts survive AO cleanup | `docker run --label ao.session=$AO_SESSION_ID --label ao.spare=true ...` |
| See a session's details | `ao session get <id>` |
| Open the desktop app | `ao start` |
| Check the daemon is up | `ao status` |
| Run health checks | `ao doctor` |
| List orchestrator sessions | `ao orchestrator ls` |
| Claim an existing PR for the current session | `ao session claim-pr <pr-ref>` (`AO_SESSION_ID`) |
| Claim an existing PR for another session | `ao session claim-pr <id> <pr-ref>` |
| Submit a code review verdict | `ao review submit <session-id> --run <run-id> --verdict approved` |
| Configure a project's default branch or model | `ao project set-config <id> --default-branch <branch> --model <model>` |
| Import projects from a legacy AO install | `ao import --dry-run` (preview), then `ao import -y` |
