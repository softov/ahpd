---
title: An action on a chat or session nobody has - implemented
date: 2026-11-02
refs:
  - git://6c71a804 - the change
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
---

An action naming a chat or a session this host does not know is answered as VS Code's host answers it.
A session's read or archive toggle for an unknown session is dropped, with nothing kept and nothing said.
Any other session action on an unknown session is refused, as before.
A read or an archive of an unknown chat is refused in the reference host's words.
Any other action on an unknown chat is said back on its channel with the client's origin, and runs nothing.

## What was built

- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - `knownSession`, the check of an unknown chat, and the dropped toggle.
- [`code://packages/sdk/test/host-chats.test.ts`](../../../../packages/sdk/test/host-chats.test.ts) - the four answers, one case each.
- [`code://packages/sdk/test/host-snapshots.test.ts`](../../../../packages/sdk/test/host-snapshots.test.ts) - the draft for a chat nobody has, taken and kept nowhere.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - *An action naming nothing here*, and the one action dropped in *What a refusal is*.

## Verified

- On `60fa2ccd`'s `actions.ts` the dropped toggles fail: two `root/sessionSummaryChanged` rows were said for the unknown session.
- On it the chat flags fail for their words, "names nothing here", and the action on a gone chat fails, refused.
- On it the draft case fails, refused, and the refused session action passes.
- With `6c71a804` the sdk test files but `nested-process` pass, 3938 tests in 207 files, the protocol's cases among them.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Left as it is: a worker chat of a known session is that session's, whatever its call, and its backend decides an action on it.
- VS Code's host records each worker it spawned, and reads a worker chat with no such record as unknown.
- Left as it is: a refused session action on an unknown session keeps this host's words for its reason.
- VS Code's host refuses one with its restore's error, "No agent for session" or "Session not found on backend".
