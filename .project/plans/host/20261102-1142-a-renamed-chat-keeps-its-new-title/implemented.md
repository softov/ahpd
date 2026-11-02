---
title: A renamed chat keeps its new title - implemented
date: 2026-11-02
refs:
  - git://ce8c9b6b - the change
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

A client that renames a chat on the chat's own channel is answered there, and the chat keeps the new title past its next turn.
The chat's held state and its row take the title together, as VS Code's host renames a chat.
A renamed default chat renames its session after its row.

## What was built

- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `renameChat` sets the chat's held title and says its row, then a default chat's session title.
- The same file has `renameSession`, the steps of a rename on the session's own channel.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a rename on a chat's channel is said back there, then `renameChat`; one on the session's channel goes to `renameSession`.
- [`code://packages/sdk/test/host-chats.test.ts`](../../../../packages/sdk/test/host-chats.test.ts) - a peer chat and a default chat renamed on their channels.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `session/titleChanged` row.

## Verified

- On `6e6d1ca8`'s `chatactions.ts` and `tooling.ts` both new cases fail: each heard the session's action alone, where the chat's channel and the row are owed.
- With `ce8c9b6b` the file passes, 56 of 56.
- A probe on `6e6d1ca8` read a renamed peer chat's row as `Renamed`, then `New session` after its next turn; with the change, `Renamed` after it.
- The 21 unit files that rename a session or a chat pass with the change, 1405 tests, all the protocol's cases among them.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- None.
