---
title: A running session is never announced removed
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L380-L392](../../../../packages/sdk/src/host/catalogue.ts#L380-L392) - `listing` skips claimed ids"
  - "[code://packages/sdk/src/host/catalogue.ts#L640-L675](../../../../packages/sdk/src/host/catalogue.ts#L640-L675) - `rowsMoved` and its removal loop"
  - "[code://packages/sdk/test/host-catalogue-held.test.ts](../../../../packages/sdk/test/host-catalogue-held.test.ts) - the held-catalogue cases to extend"
---

## Objective

A refresh never sends `root/sessionRemoved` for a session this host is serving, whether it was opened from a listed row or created while the refresh was in flight.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:640-675` - the removal loop skips a resource this host holds or has claimed.
- `UPDATE: packages/sdk/test/host-catalogue-held.test.ts` - the cases below.

## Steps

1. Write the failing case first: a listed row is opened and given a turn, then `listSessions` is called; the client must see no `root/sessionRemoved` for it, and its `sessionSummaryChanged` keep coming. The review's probe did exactly this and got `root/sessionRemoved` mid-turn.
2. A second case: a session created while a refresh is in flight, whose transcript that refresh lists.
3. In `rowsMoved`'s loop over `was`, skip a resource that `sessions` holds or whose id is claimed, the same set `listing` skips at 386. Such a row is not gone; it is live, and its summary comes from the session.
4. Keep `forgetSent` for the skipped resource untouched, so a live session's summaries are still compared against what was sent.

## Validation

- The two cases fail on `main` and pass after.
- `pnpm exec vitest run packages/sdk/test/host-catalogue*.test.ts packages/sdk/test/host-past-open.test.ts`.

## Resume
