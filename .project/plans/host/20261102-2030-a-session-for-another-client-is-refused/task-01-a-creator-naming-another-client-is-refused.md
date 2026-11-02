---
title: A creator naming another client is refused
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L947-L962](../../../../packages/sdk/src/host/sessionmethods.ts#L947-L962) - `createSession`'s first checks"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1037-L1072](../../../../packages/sdk/src/host/sessionmethods.ts#L1037-L1072) - the creator's entry"
---

## Objective

A `createSession` whose `activeClient.clientId` is not the connection's is refused with `-32602`, before anything is claimed or made.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:947-962` - the creator's id is checked.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1037-1072` - the creator's entry is the one it sent.
- `UPDATE: packages/sdk/test/presence.test.ts` - a creator naming another client is refused, and nothing is made.

## Steps

1. Read the creator's entry and the connection's id at the top of `createSession`, and refuse a mismatch.
2. Hold the entry the creator sent, with its `tools` filled as today.
3. Change the case that holds a creator naming another client to the refusal.
4. Give a creator's entry its id in each case that left the id out.

## Validation

- `packages/sdk/test/presence.test.ts`: the changed case fails on `89ebe4d5` and passes after.
- The files that create a session with a creator's entry pass.
- `pnpm run typecheck` is clean.

## Resume

Not started.
