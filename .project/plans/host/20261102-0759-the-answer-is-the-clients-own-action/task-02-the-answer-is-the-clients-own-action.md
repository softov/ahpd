---
title: The answer is the client's own action
status: done
depends: [task-01-an-action-is-answered-on-its-own-channel.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - a backend's action on its way out, and `handedFrom`"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the oracle's rows for a rewritten echo"
---

## Objective

Where a backend's action answers a client's dispatch, the action said is the client's own.
A field the client left out, and a message's origin, are the backend's.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts` - the answer carries the client's action; `handedFrom` holds the dispatch.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - the rows for a rewritten turn start, queued turn start and reorder go.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - a denial's reason reaches every client.

## Steps

1. In the backend's `emit`, find the current or the held dispatch that the action answers.
2. Say the client's action, and fill each field the client left out from the backend's action.
3. Fill a missing message origin from the backend's message.
4. Remove the oracle's `echoRewritten` and `reorderRewritten` rows.

## Validation

- `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` - passes; on c3c8c3e4 the twelve cases differ from the protocol.
