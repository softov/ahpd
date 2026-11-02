---
title: Every accepted action goes to every subscriber
status: planned
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `emit`, `refuse` and `echoTo`"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - nine sender-only answers"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - six sender-only answers"
---

## Objective

Every accepted client action goes out through `dispatch`, to every subscriber of its channel.
A refusal takes the next `serverSeq`.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `echoTo` removed; `refuse` moves `serverSeq`; the rule at the top and `emit`'s comment say so.
- `UPDATE: packages/sdk/src/host/context.ts` - `echoTo` removed from the context.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a chat bit, a draft, a session and a chat folder, a cancel naming another turn and a background request go through `dispatch`.
- `UPDATE: packages/sdk/src/host/actions.ts` - a review, a run's cancel, an unchanged set, a session bit, terminal input and a terminal title go through `dispatch`.
- `UPDATE: docs/sdk/AHP.md` - the section on accepted actions, and every row that said sender-only.
- `UPDATE: docs/sdk/CHATS.md` - `serverSeq` moves with every envelope.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - the ten `senderOnly` rows and the reason go.
- `UPDATE: packages/sdk/test/presence.test.ts` - an unchanged set and a session bit go to every client; a client that reconciles as VS Code does sends once.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - a refusal after a subscribe is above the snapshot's `fromSeq`; a held draft and a chat read again go to the chat's clients.
- `UPDATE: packages/sdk/test/changes-review.test.ts`, `host-files.test.ts`, `host-harness.test.ts`, `host-terminals.test.ts` - each no-op case reaches every client.

## Steps

1. Replace each `echoTo(connection.peer, channel, action, origin)` with `dispatch(channel, action, origin)`.
2. Send an unchanged active client set as the host's normalized entry, as a changed one goes.
3. Remove `echoTo` from `host.ts` and the context.
4. Move `serverSeq` in `refuse` before its envelope.
5. Rewrite the comments and docs that said sender-only.
6. Drop the oracle's `senderOnly` rows, and change each test that asserted the sender alone.

## Validation

- `pnpm exec vitest run packages/sdk/test/presence.test.ts packages/sdk/test/ahp-test-cases.test.ts` - passes; fails on e4694965.
- `pnpm run typecheck` - no errors.
