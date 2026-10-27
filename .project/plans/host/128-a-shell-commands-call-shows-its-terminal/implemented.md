---
title: A shell command's call shows its terminal as it is, while it runs - implemented
date: 2026-10-27
refs:
  - git://856fd305
  - "[code://packages/sdk/src/host/terminals.ts](../../../../packages/sdk/src/host/terminals.ts)"
  - "[code://packages/sdk/test/support/pty.ts](../../../../packages/sdk/test/support/pty.ts)"
---

Every backend's `!` call names its terminal as soon as the terminal opens, with `chat/toolCallContentChanged`, as the reference host's own does.
The terminal block says `isPty` as the terminal's state does, on the `!` call and on a terminal an ACP server opened.
A cofold call is held as a watching client holds it while it runs.
A pi call is a `terminal` call that names its terminal.

## What was built

- [p1 - The host says a command's terminal as it opens](../128-p1-the-host-says-a-commands-terminal-as-it-opens/implemented.md).
- [p2 - A Claude command shows its terminal](../128-p2-a-claude-command-shows-its-terminal/implemented.md).
- [p3 - An ACP command and terminal say what they are](../128-p3-an-acp-command-and-terminal-say-what-they-are/implemented.md).
- [p4 - A cofold command shows its terminal](../128-p4-a-cofold-command-shows-its-terminal/implemented.md).
- [p5 - A pi command is a terminal call](../128-p5-a-pi-command-is-a-terminal-call/implemented.md).

## Verified

- The seven new cases fail on the code before this plan with an assertion, and pass after it.
- `pnpm boundary`, `pnpm typecheck` and `pnpm build` pass.
- The agent-claude, agent-acp, agent-cofold and agent-pi suites pass, 1110 of 1110.
- The sdk suite passes 3564 of 3567.
  The other is a nested host case that runs past its budget here, and it fails the same way on the code before host 127.

## Departures from the plan

- none.

## Left for later

- none.
