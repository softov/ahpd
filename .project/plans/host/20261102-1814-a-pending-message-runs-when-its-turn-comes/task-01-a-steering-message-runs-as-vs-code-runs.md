---
title: A steering message runs as VS Code runs it
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1396-L1458](../../../../packages/sdk/src/host/chatactions.ts#L1396-L1458) - the pending message case"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L252-L256](../../../../packages/sdk/test/ahp-test-cases.test.ts#L252-L256) - the protocol cases' row for idle steering"
---

## Objective

A steering message sent with no turn running is answered and runs as a turn of its own, named by its id.
The steering message a running turn holds, sent again unchanged, is answered and reaches the backend once.
The same id with another message is refused in the reference host's words.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1396-1458` - the idle steering message takes the queued path, and a held one sent again is answered or refused.
- `UPDATE: packages/sdk/test/host-input.test.ts:571-584` - the idle steering message runs as a turn under its id.
- `CREATE: packages/sdk/test/host-steering.test.ts` - a held steering message sent again, the same and changed.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:252-256` - cases 039, 040, 041 and 052 run the message as a turn.
- `UPDATE: docs/sdk/AHP.md:286` - the `chat/pendingMessageSet` row.
- `UPDATE: docs/sdk/CHATS.md:47` - the steering paragraph in *Turns*.

## Steps

1. Read the chat's held steering message before the host asks any backend.
2. Answer the held message sent again unchanged, and refuse it changed.
3. Read the message's attachments once, for both kinds.
4. Run a steering message the backend could not steer through the queued path, under its id.
5. Change the idle steering case in `host-input.test.ts` to read the turn and its `queuedMessageId`.
6. Add the two cases of a held message sent again.
7. Move the four protocol cases from a refusal to the keys the turn moves.
8. Describe both in `AHP.md` and `CHATS.md`.

## Validation

- `packages/sdk/test/host-input.test.ts` and `packages/sdk/test/host-steering.test.ts`: the three cases fail on `89ebe4d5` and pass after.
- `packages/sdk/test/ahp-test-cases.test.ts` passes.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- The held message compares by value with `isDeepStrictEqual`: the reducer's copy writes its keys in another order.
- `host-input.test.ts` moved with the behavior: its case read the refusal of an idle steering message.
- The protocol cases 039, 040, 041 and 052 moved from that refusal to the keys the turn moves.
- Their row in `BROKEN` names VS Code's host as the reason the case's `expected` is not met.
- On `89ebe4d5`'s sources the three cases fail: the idle message was refused, and the held one went to the backend twice.
