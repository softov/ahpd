---
title: The picked agent reaches the backend
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L205-L210](../../../../packages/sdk/src/types/session.ts#L205-L210) - `MessageFrom`"
  - "[code://packages/sdk/src/host.ts#L5572-L5585](../../../../packages/sdk/src/host.ts#L5572-L5585) - `messageFrom`"
---

## Objective

`MessageFrom` carries `agent?: { uri: string }`, filled from `message.agent` on every send path: a live session, a resumed one and a queued message.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:205-210` - `agent` on `MessageFrom`, documented as the protocol's `AgentSelection`.
- `UPDATE: packages/sdk/src/host.ts:5572-5585` - `messageFrom` copies it.
- `UPDATE:` the host tests for `chat/turnStarted`.

## Steps

1. Tests first with a fake backend: a live, a resumed and a queued message with `agent` each hand the backend `from.agent`; without it, none.
2. Implement in `messageFrom`, which every path already calls.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
