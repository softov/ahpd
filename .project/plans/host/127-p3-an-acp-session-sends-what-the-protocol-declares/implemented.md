---
title: An ACP session sends what the protocol declares - implemented
date: 2026-10-27
refs:
  - git://288ddab7
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts)"
  - "[code://packages/agent-acp/src/session/handlers.ts](../../../../packages/agent-acp/src/session/handlers.ts)"
---

An ACP session sends only what the protocol declares, and its snapshot holds the calls a client that watched built.
Its tool call parts have no `id`, its commands are the children of one read-only directory, and its record of a call follows the reducer.

## What was built

- [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) - `callPartOf` by the call's id, and `ready`, `shown` and `closed` put what they send onto the held call.
- [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts) - `commandsIn`, and the permission and confirmation lookups by the call's id.
- [`code://packages/agent-acp/src/session/queue.ts`](../../../../packages/agent-acp/src/session/queue.ts) - the shell command's part has no `id`.
- [`code://packages/agent-acp/test/agent-acp-ports.test.ts`](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - a reported call, a call asked about first and a shell command, read through the host.

## Verified

- The case fails before this change with nine findings, and passes after it.
- The agent-acp suite passes, 282 of 282; three cases read a call by the call's id, and one reads the commands from the directory.

## Departures from the plan

- none.

## Left for later

- none.
