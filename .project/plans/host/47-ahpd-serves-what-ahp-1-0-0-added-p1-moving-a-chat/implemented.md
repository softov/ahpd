---
title: A chat is reordered in its session, or moved to another session of the same agent and machine - implemented
date: 2026-10-09
refs:
  - git://90568ea
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - the `moveChat` handler and `movedTo`"
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts) - `movable`, `chatsReordered` and the catalogue rows a move sends"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts) - `moveChat` on both stores"
  - "[code://docs/AHP.md](../../../../docs/AHP.md) - the `moveChat` row"
---

`moveChat` is served. A chat that advertises `movable` is put earlier or later among its session's chats. It is moved into another session of the same agent provider on the same machine, or out into a session of its own. It keeps its URI, its turns and its own folders. Five moves are refused, each with a sentence naming why and with nothing changed. Into a session of another provider. Into a session on another computer. The default chat. A chat that runs a turn. A chat whose backend cannot take the conversation back by its own id.

## What was built

- `movable(uri)`: true for a chat this host holds that is not its session's default. Its backend must be able to take the conversation back by its own id. Nothing it carries may be running a turn. The chat's state and every summary of it carry the flag. A change goes out as `chat/movableChanged`, with `session/chatUpdated` beside it.
- The `moveChat` handler in [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts). A destination naming the chat's own session reorders `held.chats`, writes the order down and says `session/chatsReordered`.
- `movedTo`, in the same file, for the other two destinations. It closes the chat and every worker of it. It moves the store's rows, `byChat` and the claims. Then it spawns under the destination with `resume` and `chatId` set to the chat's backend id. The start is seeded with the chat's turns and runs on its own folders.
- A spawn that throws spawns the chat back under the source. It restores the source's chat order too, and answers the backend's error.
- The source is told `session/chatRemoved`. The destination is told `session/chatAdded` and `session/chatsReordered`. Both catalogue rows move. All of it goes out after ownership and order are written, so a client never reads the chat in two places or in none.
- A `newSession` destination allocates a session named after the chat's backend id. It takes the source's provider and config and the chat's folders. The moved chat is its non-movable default chat, under the URI it already had.
- [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts) - `moveChat(from, to, uri, turns)`. It moves the chat's entry in the stored chat list, its title and the senders of the turns it owns. One write per row, on the file store and in memory.
- [`code://packages/sdk/src/host/admission.ts`](../../../../packages/sdk/src/host/admission.ts) - a move into another session asks `session:write` on it. The chat's own move asks `chat:move`, and a `newSession` destination asks `session:create`.
- `docs/AHP.md`: the `moveChat` row says what a move does and what it refuses.

## Verified

- `packages/sdk/test/host-chats.test.ts`, in `more than one chat in a session`.
- A chat moved into another session leaves the snapshot and catalogue row of the session it left. It arrives after the anchor named. It keeps its URI, its turns and its own folders. Its new start carries `resume` and `chatId` equal to its backend id. A turn sent on it after the move runs.
- A worker of a moved chat moves with it and still resolves. A move to another provider, to another computer or to a session this host is not running is refused, and both sessions are unchanged. A spawn that throws leaves the chat where it was. `newSession` answers a session whose default chat is the moved one.
- `newSession` over a second host on the same file store: the chat is rebuilt in it as that session's chat, and the session lists once.
- `packages/sdk/test/sessions.test.ts`: the file store's `moveChat` moves a title, a sender and the chat list entry. A second store reads them under the destination. The memory store moves them the same way.
- `packages/sdk/test/conformance.test.ts` and the wire fixture, which the suite regenerates.
- `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run --maxWorkers=2 --testTimeout=10000` pass on the review tree, merged with host/44 p3: 268 files, 4801 tests.

## Departures from the plan

- Task 03: `moveChat` on both stores takes a fourth `turns` argument, which the task's Files line did not name. A sender is kept per session and per turn. The store cannot know which of them belong to the moving chat unless the host says so.
- Task 03: `channels.ts`'s `URI_KEYS` gained `chats`. The protocol types that field as URIs on `session/chatsReordered` and as summaries everywhere else. Only a string is read for a URI there, and the reorder's list is rewritten for a client watching a session under another name.
- Task 03: `admission.ts` asks `session:create` for a `newSession` destination. The plan's decision row named only the `session:write` half. A destination that does not exist yet has nothing else to ask it for.
- Task 03: `chatIdOf` is exported from `lifecycle.ts`. `chatOf` answers for a worker this host holds before it reads a session out of the worker's URI. With that guard removed the whole suite still passes, so it is a guard rather than a dependency. The fallback re-mints the same URI while the session a worker was opened in is one the host still names.
- Task 03: a `newSession` move does not fire a `session_start` automation trigger, because the chat is not a new conversation.
- Task 02 and 03: `chatrecord.ts` gained `orderChats`, which writes a session's chats down in a new order. The tasks' Files lines named neither that file nor `routing.ts`, `admission.ts` and `lifecycle.ts`.

## Left for later

- A move into a session of another provider, and a move into a session on another computer - see [deferred.md](deferred.md).
