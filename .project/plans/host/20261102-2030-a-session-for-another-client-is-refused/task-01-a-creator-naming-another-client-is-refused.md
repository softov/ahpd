---
title: A creator naming another client is refused
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L947-L962](../../../../packages/sdk/src/host/sessionmethods.ts#L947-L962) - `createSession`'s first checks"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1037-L1072](../../../../packages/sdk/src/host/sessionmethods.ts#L1037-L1072) - the creator's entry"
---

## Objective

A `createSession` whose `activeClient` names a `clientId` other than the connection's is refused with `-32602`, before anything is claimed or made.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:947-962` - the creator's id is checked.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1037-1072` - the creator's entry is the one it sent.
- `UPDATE: packages/sdk/test/presence.test.ts` - a creator naming another client is refused, and nothing is made.
- `UPDATE: docs/sdk/AHP.md` - the `createSession` row.

## Steps

1. Read the creator's entry and the connection's id at the top of `createSession`, and refuse an entry naming another id.
2. Hold the entry the creator sent, with a `clientId` and `tools` it left out filled as today.
3. Change the case that holds a creator naming another client to the refusal.
4. Change the `createSession` row of AHP.md.

## Validation

- `packages/sdk/test/presence.test.ts`: the changed case fails on `89ebe4d5` and passes after.
- The files that create a session with a creator's entry pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- On `89ebe4d5`'s source the changed case fails: the request resolves, and the creator is held as this connection.
- An entry with no `clientId` takes the connection's, as a set's does, so the cases that leave it out stand.
- The eleven files that create a session with a creator's entry pass, the nested proxy's timing case alone.
