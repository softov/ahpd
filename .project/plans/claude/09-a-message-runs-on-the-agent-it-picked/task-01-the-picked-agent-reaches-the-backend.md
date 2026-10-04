---
title: The picked agent reaches the backend
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L219-L225](../../../../packages/sdk/src/types/session.ts#L219-L225) - `MessageFrom`"
  - "[code://packages/sdk/src/host.ts#L6752-L6764](../../../../packages/sdk/src/host.ts#L6752-L6764) - `messageFrom`, whose early return at L6759 answers undefined with neither `origin` nor `_meta`"
---

## Objective

`MessageFrom` carries `agent?: { uri: string }`, filled from `message.agent` on every send path: a live session, a resumed one and a queued message.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:219-225` - `agent` on `MessageFrom`, documented as the protocol's `AgentSelection`.
- `UPDATE: packages/sdk/src/host.ts:6752-6764` - `messageFrom` copies it, and its early return at L6759 answers undefined only when `origin`, `_meta` and `agent` are all absent.
- `UPDATE:` the host tests for `chat/turnStarted`.

## Steps

1. Tests first with a fake backend: a live, a resumed and a queued message with `agent` each hand the backend `from.agent`; without it, none; a message with `agent` and neither `origin` nor `_meta` still hands `from.agent`.
2. Implement in `messageFrom`, which every path already calls: read `agent` beside `origin` and `_meta`, and change the early return to test all three.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
