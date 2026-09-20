---
title: A renamed chat comes back with its title after the host restarts
status: todo
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/sessions.ts#L27-L57 - `SessionStore`, which gains the chat-title pair
  - code://packages/sdk/src/sessions.ts#L16-L29 - `memorySessions`, the slots a store holds
  - code://packages/sdk/src/sessions.ts#L45-L49 - `Saved`, the persisted shape
  - code://packages/sdk/src/sessions.ts#L80-L108 - `save`, which turns the slots into JSON
  - code://packages/sdk/src/sessions.ts#L118-L153 - `load` and the store a restart reads
  - code://packages/sdk/src/host.ts#L2231-L2244 - the in-memory chats map and `held.chats.set`, where a chat is created
  - code://packages/sdk/src/host.ts#L3198-L3214 - `renameChat`, which sets the title and dispatches it
  - code://packages/sdk/src/host.ts#L3284 - the title given when a session is opened
  - code://packages/sdk/src/host.ts#L3297 - the title given when a chat is created
  - code://packages/sdk/src/host.ts#L3302 - the tool context's `rename`
  - code://test/sessions.test.ts#L78-L124 - the restart tests this one joins
  - code://test/host.test.ts#L2872-L2902 - the title cases a restart case joins
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L56-L92 - a title persisted per chat and restored when it hydrates
---

## Objective

A title given to a chat by a client or by `rename_chat` is written to the session store, and a chat created again after a restart is given that title before any client sees it.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts:27-57` - `chatTitle(id, chatUri)` and `setChatTitle(id, chatUri, title)` on `SessionStore`.
- `UPDATE: packages/sdk/src/sessions.ts:16-29` - `memorySessions` keeps a map of chat titles per session id.
- `UPDATE: packages/sdk/src/sessions.ts:45-49` - `Saved.sessions[]` gains `chatTitles?: Record<string, string>`.
- `UPDATE: packages/sdk/src/sessions.ts:80-108` - `save` writes the slot when it is not empty.
- `UPDATE: packages/sdk/src/sessions.ts:118-141` - `load` reads it back with a string check per entry.
- `UPDATE: packages/sdk/src/sessions.ts:145-153` - the returned store forwards both methods, and `forget` deletes the slot.
- `UPDATE: packages/sdk/src/host.ts:2231-2244` - `spawn` applies `kept.chatTitle(idOf(uri), chatUri)` to the new chat.
- `UPDATE: packages/sdk/src/host.ts:3198-3214` - `renameChat` writes the title before it dispatches.
- `UPDATE: packages/sdk/src/host.ts:3284` and `:3297` - a title given when a session or a chat is created is written too.
- `UPDATE: test/sessions.test.ts` - a case for the slot and the restart.
- `UPDATE: test/host.test.ts:2872-2902` - a case that renames and restarts.

## Steps

1. Add `chatTitle(id: string, chatUri: string): string | undefined` and `setChatTitle(id: string, chatUri: string, title: string): void` to `SessionStore`, commented as the title a chat was given, which the catalogue does not carry.
2. `memorySessions` holds `const chatTitles = new Map<string, Map<string, string>>()`; `setChatTitle` creates the inner map, sets the title, and deletes the slot when the title is an empty string.
3. `Saved.sessions[]` gains `chatTitles`, written only when the inner map has entries; `load` accepts only `Record<string, string>` entries and ignores the rest, the way it already filters artifacts.
4. The returned file store adds `known.add(id)` and `later()` for `setChatTitle`, and `forget` drops the slot.
5. In `spawn`, after `held.chats.set(chatUri, session)`, apply `const keptTitle = kept.chatTitle(idOf(uri), chatUri); if (keptTitle !== undefined) session.setTitle?.(keptTitle);` so a restored chat is named before `sessionAdded`.
6. In `renameChat`, call `kept.setChatTitle(idOf(uri), chatUri, title)` beside `found.setTitle?.(title)`, since a client's `session/titleChanged` and `rename_chat` both come through here.
7. Where a title is given at creation, `openSession`'s `title` parameter and `createChat`'s `asked.title`, write it to the store as well, so a first name survives a restart the way a later rename does.

## Validation

- `test/sessions.test.ts`: a new case sets two chat titles on one session id, reads them from a second `fileSessions` on the same file after the coalesced write, asserts an unrelated chat answers `undefined`, and asserts `forget` drops them.
- `test/host.test.ts`: with `fileSessions` on a temporary file, rename a peer chat through `session/chatUpdated`, restart on the same file, subscribe to the session, and assert the chat row's `title` is the one given.
- `pnpm vitest run test/sessions.test.ts` and `pnpm vitest run test/host.test.ts` green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

