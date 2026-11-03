---
title: Every spelling of an id is the session
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/routing.ts#L56-L70](../../../../packages/sdk/src/host/routing.ts#L56-L70) - `nameOf` and `heldElsewhere`"
  - "[code://packages/sdk/src/host/routing.ts#L106-L150](../../../../packages/sdk/src/host/routing.ts#L106-L150) - `sessionOfChat`, `meantBy` and `shownToOlder`"
---

## Objective

Every spelling of a session's id resolves to the session this host publishes: the channel, its marks, its changesets and a chat derived from it.
A client is answered under the name it used, and a scheme no agent here serves names no session.

## Files

- `UPDATE: packages/sdk/src/host/routing.ts:56-70` - `heldElsewhere` goes, and `nameOf` says what one name is for.
- `UPDATE: packages/sdk/src/host/routing.ts:106-150` - `sessionOfChat`, `meantBy` and `shownToOlder` read the id.
- `UPDATE: packages/sdk/src/host/chatactions.ts:448-530` - a config change, a draft and a turn reach the session.
- `UPDATE: packages/sdk/src/host/sleep.ts:409-412` - a wake reaches the session.
- `UPDATE: packages/sdk/test/host-names.test.ts:284-390` - every spelling answers the row, and what is sent there applies.
- `UPDATE: packages/sdk/test/users-gate-sessions.test.ts:122-145` - a provider's scheme of a listed row is that row.
- `UPDATE: packages/sdk/test/users-gate-sessions.test.ts:258-272` - a scheme no agent serves is refused.
- `UPDATE: docs/sdk/AHP.md` - the section on a session's names.

## Steps

1. Resolve a session channel's base, with its suffix, to the name this host publishes.
2. Resolve a chat derived from any spelling to the session's own chat.
3. Read a shaped chat's session by id in `shownToOlder`.
4. Remove `heldElsewhere` and the six sites that read it.
5. Change the cases that asserted another spelling is no session.
6. Describe a session's names in `docs/sdk/AHP.md`.

## Validation

- `packages/sdk/test/host-names.test.ts`: the changed cases fail on `cde4dd6c` and pass after.
- The names, gate, chats, snapshot and catalogue test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-03.
