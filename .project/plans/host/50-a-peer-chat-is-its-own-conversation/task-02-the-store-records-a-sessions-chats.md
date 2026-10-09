---
title: The store records a session's chats
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/sessions.ts#L143-L153](../../../../packages/sdk/src/types/sessions.ts#L143-L153) - `chatTitle`, `setChatTitle`, `forget`"
  - "[code://packages/sdk/src/sessions.ts#L39-L42](../../../../packages/sdk/src/sessions.ts#L39-L42) - the memory store's per-chat map and its `forget`"
  - "[code://packages/sdk/src/sessions.ts#L194-L212](../../../../packages/sdk/src/sessions.ts#L194-L212) - `rowOf`, what the file store writes for a session"
  - "[code://packages/sdk/test/sessions.test.ts#L260-L280](../../../../packages/sdk/test/sessions.test.ts#L260-L280) - forgetting and remembering across a restart"
---

## Objective

`SessionStore.chats(id)` answers the chats a session has, each `{ uri, backendId, title?, origin?, default? }`, and `setChats(id, list)` replaces them; both stores keep the list, the file store across a restart, and `forget` drops it.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts` - `StoredChat` and the two methods beside `chatTitle`.
- `UPDATE: packages/sdk/src/sessions.ts` - the memory store's map; the file store's row field, written with the rest of the row.
- `UPDATE: packages/sdk/test/sessions.test.ts` - the cases below.

## Steps

1. Add the type and the methods; an unknown session answers `[]`.
2. The file store reads a row without the field as `[]`, so rows written before this keep loading.

## Validation

- `packages/sdk/test/sessions.test.ts`: the memory store answers what it was given; the file store writes two chats, one `default`, and a new store over the same temp directory reads them back in order; `forget` drops them; a row written without the field reads as `[]`.
- `pnpm test` passes.

## Resume

Built on `build/agents/830a472f` on 2026-10-09 and left uncommitted.

`StoredChat` is in `packages/sdk/src/types/sessions.ts` beside `chatTitle`, with `chats(id)` and `setChats(id, list)` on `SessionStore`. The memory store holds the list as a row field. It holds an empty list as the field's absence, so a session with no chat left is a session nothing was recorded for. The file store writes it as the row's last field, so a row written before this one keeps its bytes. `chatsOf` reads a list back, and keeps each entry that names a URI and a backend id.

`origin` is `Record<string, unknown>`, the shape `madeFrom` already holds and `session/chatAdded` already carries, rather than a second spelling of it. `keepChat` mirrors it into the row from where the host keeps it, because a chat is spawned before its origin is written down. `stored` seeds `madeFrom` back from the row, so a chat listed into the catalogue after a restart still says it was forked.

Two files the Files line does not name. `packages/sdk/src/index.ts` re-exports the type. `packages/sdk/src/validate.ts` lists the required members of a contributed `sessions` port, and `packages/sdk/test/plugin-validate.test.ts` holds the stub those names are checked against.
