---
title: The entry keeps the tools it was sent
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/actions.ts#L800-L811](../../../../packages/sdk/src/host/actions.ts#L800-L811) - a set's entry"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1039-L1067](../../../../packages/sdk/src/host/sessionmethods.ts#L1039-L1067) - the creator's entry"
  - "[code://packages/sdk/test/presence.test.ts#L340-L357](../../../../packages/sdk/test/presence.test.ts#L340-L357) - the replace case, the pattern for the new cases"
---

## Objective

A set's entry and the creator's entry are held, echoed and shown as the client sent them.
An entry with no `tools` stays with no `tools`, and its client provides no tool to the session's chats.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:800-811` - the entry is the client's, with the connection's `clientId`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1039-1067` - the creator's entry the same.
- `UPDATE: packages/sdk/test/presence.test.ts` - an entry with no `tools`, from a set and from a creator, held and echoed with none.
- `UPDATE: docs/sdk/AHP.md` - the row for `session/activeClientSet` says the entry is held as sent.

## Steps

1. Build a set's entry from the client's fields and the connection's `clientId`, and nothing else.
2. Build the creator's entry the same way.
3. Rewrite both comments for the entry as the client sent it.
4. Add a case that sends a set with no `tools` and reads the echo and the snapshot.
5. Add a case that creates a session with an entry that has no `tools` and reads the snapshot.
6. Check that a client with no `tools` leaves the chats' tools as they were.
7. Write in `AHP.md` that the host keeps the entry the client sent.

## Validation

- `packages/sdk/test/presence.test.ts`: the new cases fail on `89ebe4d5` and pass after the change.
- `presence`, `host-tools`, `host-catalogue`, `client-plugins-session`, `host-names` and `wire` pass.
- This task's *Resume* names each test file whose assertion moves with the behavior.
- `pnpm run typecheck` is clean.

## Resume

Not started.
