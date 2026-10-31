---
title: An MCP server a client starts or stops is answered by its state - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-claude/src/session/servers.ts](../../../../packages/agent-claude/src/session/servers.ts) - `request`, `startMcpServer`, `stopMcpServer`, the servers a stop switched off"
  - "[code://packages/agent-claude/src/session/customizations.ts](../../../../packages/agent-claude/src/session/customizations.ts) - the enablement of a server a stop switched off"
---

A client's start or stop of an MCP server on a Claude session is answered once, by the request said with the client's origin, and followed by the state the CLI reports, the state the server was in included.
A stop keeps the server's enablement, and a start of a server a stop switched off lifts the CLI's disabled flag before it reconnects.

## What was built

- [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) - `request` says a start or a stop and gives the entry the session holds what the protocol's reducer gives every client's: `starting` or `stopped`, with no `channel`. The refresh after the CLI's call measures against that entry, so it says the state the CLI reports whether or not it moved. A start or a stop once said answers true, a CLI call that throws included; false is the answer for an id that names no server, before anything is said. The switch on of a server that was not ready says its start the same way. `stopRequested` keeps the servers a client's stop switched off while they were on; a start of one lifts the CLI's flag first, and a client's switch of one takes it out.
- [`code://packages/agent-claude/src/session/customizations.ts`](../../../../packages/agent-claude/src/session/customizations.ts) - a server the CLI reports `disabled` reads on when it is in `stopRequested`.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), the `session/mcpServerStartRequested` and `session/mcpServerStopRequested` rows.
- The fake SDK's toggle and reconnect throw when a case sets `mcpFails`, as the SDK's calls do on failure.
- Five cases in `host-harness.test.ts`: a start of a ready server followed by `ready`; a start whose sign-in throws, answered once and followed by the state; a stop that keeps the enablement and reads `stopped`, with a switch off after it the client's; a start after a stop that switches the server on before it reconnects and follows with `ready`; a stop whose toggle throws, followed by the state the server still has.

## Verified

- On `08b1d57a` each case fails for the reason it names: no `session/mcpServerStateChanged` follows a start that leaves the server as it was; a start or a stop whose CLI call throws is answered twice, the request and then a refusal ("mcp:desk would not start", "mcp:desk would not stop"); a stop is followed by a `session/customizationUpdated` switching the server off; a start after a stop never lifts the CLI's flag.
- After the change, the agent-claude suite with `host-harness`, `host-tools`, `client-plugins-session`, `toolauth`, `authenticate-watching`, `nested-proxy`, `ahp-test-cases` and `conformance` pass: 64 files, 1396 tests.
- The round's full run at two workers: `test:unit` passes 7351 cases with none failed; `test:processes` passes 691 with four 5 s timeouts in `computer-libvirt` (2), `computer-plugin` and `devcontainer`, and the three files pass whole alone (85).
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- none.

## Left for later

- A server the CLI reports `failed` reads switched off, a reading of state as intent this plan leaves where it is.
