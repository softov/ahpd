---
title: A backend that takes no steering refuses it
status: done
depends: []
layer: "sdk, agent-acp, examples"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1437-L1520](../../../../packages/sdk/src/host/chatactions.ts#L1437-L1520) - the pending message case and its refusal"
  - "[code://packages/agent-acp/src/session/queue.ts](../../../../packages/agent-acp/src/session/queue.ts) - ACP's queue, which takes one kind"
  - git://46251ea3 - the change upstream merged, whose idle exception and ACP queue this task takes back
---

## Objective

A steering message to a backend with no `steer` is refused, a turn running or not.
ACP's queue and chat state, and both examples' queues, hold queued messages alone.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1452-1457` - the refusal holds whether or not a turn runs.
- `UPDATE: packages/agent-acp/src/session.ts` - the chat state shows no steering entry.
- `UPDATE: packages/agent-acp/src/session/queue.ts` - `queue` and `unqueue` take one kind.
- `UPDATE: examples/echo/agent.ts` - the same for the example.
- `UPDATE: examples/notes/agent.ts` - the same.
- `UPDATE: packages/sdk/test/host-steering.test.ts` - a steering message to a backend that takes none is refused.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - the same for ACP.
- `UPDATE: packages/agent-cofold/src/turns.ts` - the drain's citation.
- `UPDATE: packages/sdk/src/types/session.ts` - `queue`'s `kind`, handed only to a backend with `steer`.
- `UPDATE: packages/sdk/test/host-input.test.ts` - the drain's citation.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - the oracle row's citation.
- `UPDATE: docs/sdk/AHP.md` - the `chat/pendingMessageSet` row.
- `UPDATE: docs/sdk/CHATS.md` - which backends take steering.

## Steps

1. Refuse steering to a backend with no `steer`, idle or not.
2. Put ACP's queue and chat state, and both examples' queues, back to one kind.
3. Change the two cases that held an idle steering message on such a backend.
4. Move every citation of the drain's sentence from `L260-L262` to `L266-L267`.
5. Write which backends take steering in `AHP.md` and `CHATS.md`.

## Validation

- The two changed cases fail on `cde4dd6c` and pass after.
- `host-steering.test.ts`, `agent-acp-turn.test.ts` and `agent-cofold-turn.test.ts` pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-03 in `54aad468`.

- Upstream merged round 2's union as `#195`, so main carries the idle exception and ACP's steering queue.
- The host's refusal is main's line without `activeHeld !== undefined`.
- ACP's and the examples' files come from `46251ea3~1`, which nothing else has touched since.
- Task 02 is the order, which rests on this.
