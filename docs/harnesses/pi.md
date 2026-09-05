# Pi

AO supports Pi as a terminal-first harness: it spawns the `pi` executable inside
the session's tmux/conpty runtime and users interact with Pi's own TUI through
the daemon's mux (desktop, mobile, or CLI).

Chat-mode Pi integration (the independently installed
[`@victor-software-house/pi-acp`](https://github.com/victor-software-house/pi-acp)
driver and its TUI↔Chat handoff) was removed with the chat feature itself in
[#39](https://github.com/ercs-second-brain/agent-orchestrator/issues/39). There
is no chat driver of any kind; AO never launches `pi-acp` or any ACP transport.

## Spawn and configuration

- AO resolves `pi` from `PATH` and common user-level binary locations, exactly
  like every other agent harness, and executes it inside the session terminal.
- Pi provider credentials and configuration remain in Pi's normal agent
  directory (`PI_CODING_AGENT_DIR`, or `~/.pi/agent`). AO passes the project
  environment through unchanged and never bundles or downloads provider CLIs.
- Project instructions work the same as for any TUI harness: Pi reads its own
  `AGENTS.md`, skills, prompts, extensions, and provider config from Pi's
  config directory. AO does not synthesize or inject a second system prompt.

## Not supported

- Chat mode, structured conversation projections, chat handoff, and ACP-based
  tool/approval mapping. Approvals, images, MCP wiring, and model selection all
  happen inside Pi's own TUI, driven through the terminal.
