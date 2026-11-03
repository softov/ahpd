---
title: An input needed entry stands by its call state - implemented
date: 2026-11-03
refs:
  - git://0f7f7504 - the change
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts)"
---

A session's `inputNeeded` entry stands while its call is in the state its kind is raised for.
A confirmation entry stands at a pending confirmation or a pending result confirmation.
A client execution entry stands while the call runs, and an authentication entry at auth-required.
An ACP session asks a client to run a call once the chat holds that call running.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `askedLeft` holds each entry to its own state.
- [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) - the turn holds each client's call for its ready.
- [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts) - the held calls are asked for once the actions have gone out.

## Verified

- On `cde4dd6c`'s sources both cases fail: the entries stand through a streaming call, and the entry goes up before the ready.
- With the change the input-needed file passes 7 of 7 and tools 83 of 83.
- The ACP client tool file passes 19 of 19, its catalog 87 of 87, its ports 29 of 29, and its turns 38 of 38.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.
