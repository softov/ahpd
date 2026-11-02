---
title: An MCP server a client starts or stops is answered by its state - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-claude/src/session/servers.ts](../../../../packages/agent-claude/src/session/servers.ts) - `request`, `startMcpServer`, `stopMcpServer`, the servers a stop switched off"
  - "[code://packages/agent-claude/src/session/customizations.ts](../../../../packages/agent-claude/src/session/customizations.ts) - the enablement of a server a stop switched off"
---

A client's start or stop of an MCP server on a Claude session is answered once, by the request said with the client's origin.
The state the CLI reports follows it, the state the server was in included.
A stop keeps the server's enablement, and a start of a server a stop switched off lifts the CLI's disabled flag before it reconnects.

## What was built

- [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) - `request` says a start or a stop. It gives the session's entry what the protocol's reducer gives every client's: `starting` or `stopped`, with no `channel`. The refresh after the CLI's call measures against that entry, so it says the state the CLI reports whether or not it moved. A start or a stop once said answers true, a CLI call that throws included. False is the answer for an id that names no server, before anything is said. The switch on of a server that was not ready says its start the same way. `stopRequested` keeps the servers a client's stop switched off while they were on. A start of one lifts the CLI's flag first, and a client's switch of one takes it out.
- [`code://packages/agent-claude/src/session/customizations.ts`](../../../../packages/agent-claude/src/session/customizations.ts) - a server the CLI reports `disabled` reads on when it is in `stopRequested`.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), the `session/mcpServerStartRequested` and `session/mcpServerStopRequested` rows.
- The fake SDK's toggle and reconnect throw when a case sets `mcpFails`, as the SDK's calls do on failure.
- Five cases in `host-harness.test.ts`.
  - A start of a ready server, followed by `ready`.
  - A start whose sign-in throws, answered once and followed by the state.
  - A stop that keeps the enablement and reads `stopped`, with a switch off after it the client's.
  - A start after a stop, which switches the server on before it reconnects and follows with `ready`.
  - A stop whose toggle throws, followed by the state the server still has.

## Verified

- On `08b1d57a` each case fails for the reason it names.
  - No `session/mcpServerStateChanged` follows a start that leaves the server as it was.
  - A start or a stop whose CLI call throws is answered twice: the request, then a refusal.
  - The refusals read "mcp:desk would not start" and "mcp:desk would not stop".
  - A stop is followed by a `session/customizationUpdated` switching the server off.
  - A start after a stop never lifts the CLI's flag.
- After the change, the agent-claude suite with `host-harness`, `host-tools`, `client-plugins-session`, `toolauth`, `authenticate-watching`, `nested-proxy`, `ahp-test-cases` and `conformance` pass: 64 files, 1396 tests.
- The round's full run at two workers: `test:unit` passes 7351 cases with none failed.
- `test:processes` passes 691 with four 5 s timeouts in `computer-libvirt` (2), `computer-plugin` and `devcontainer`, and the three files pass whole alone (85).
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- none.

## After Softov's review of 2026-11-01

The review's note on `stopMcpServer`: a start that arrived while the CLI was still stopping the server skipped `toggle(true)`. The stop's mark then landed after it.

- [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) - the stop is kept in `stopRequested` before the CLI is asked, and given back when the CLI refuses it.
- `packages/sdk/test/support/claude-sdk.ts` can hold one toggle open, the CLI still making it.
- `packages/sdk/test/host-harness.test.ts`: a start sent while the stop's toggle is open lifts the flag and reconnects the server. Before the change the start made no toggle.

## Left for later

- A server the CLI reports `failed` reads switched off, a reading of state as intent this plan leaves where it is.
