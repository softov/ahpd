---
title: A chat moves to another session or a new one
status: done
depends: [task-02-a-chat-is-reordered-inside-its-session.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/state.ts#L12-L41](../../../../packages/sdk/src/host/state.ts#L12-L41) - `Held`: one agent, one config, one folder set for every chat in it"
  - "[code://packages/sdk/src/host/spawn.ts#L311-L320](../../../../packages/sdk/src/host/spawn.ts#L311-L320) - `spawn`, whose closures hold the session URI, so the chat is spawned again under the destination"
  - "[code://packages/sdk/src/host/lifecycle.ts#L422-L443](../../../../packages/sdk/src/host/lifecycle.ts#L422-L443) - `restartChat`: close, then spawn with `{ resume: agentId(), seed: allTurns() }`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L689-L719](../../../../packages/sdk/src/host/sessionmethods.ts#L689-L719) - `disposeChat`, the removal half"
  - "[code://packages/sdk/src/host/tooling.ts#L297-L308](../../../../packages/sdk/src/host/tooling.ts#L297-L308) - the internal `createChat`, the adding half"
  - "[code://packages/sdk/src/host/state.ts#L113-L142](../../../../packages/sdk/src/host/state.ts#L113-L142) - `claims`, re-claimed for the destination"
  - "[code://packages/sdk/src/host/gate.ts#L191](../../../../packages/sdk/src/host/gate.ts#L191) - `config.computer`, what names the machine a session runs on"
  - "[code://packages/sdk/src/types/sessions.ts#L93-L95](../../../../packages/sdk/src/types/sessions.ts#L93-L95) - `sender`, kept per session id and turn"
  - "[code://packages/sdk/src/types/sessions.ts#L143-L145](../../../../packages/sdk/src/types/sessions.ts#L143-L145) - `chatTitle`, kept per session id"
  - "[plans/host/50-a-peer-chat-is-its-own-conversation/plan.md](../50-a-peer-chat-is-its-own-conversation/plan.md) - the chat's own backend id and the stored chat list a move rewrites"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - a move to another session transfers the chat and every host-managed descendant; `newSession` allocates a session whose non-movable default chat is the moved one; every moved chat keeps its URI, state and `ChatOrigin`; ownership and order are committed before `session/chatRemoved`, `session/chatAdded`, `session/chatsReordered` and the root summaries go out (`channels-chat/commands.ts:164-199`)"
---

## Objective

`moveChat` with a `session` destination naming another running session of the same agent provider on the same machine moves a `movable` chat and its workers there, keeping their URIs, turns and folders; a `newSession` destination makes a new session whose default chat is the moved one; a destination on another provider or another computer is refused with a reason and nothing changed.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - the two destinations in the `moveChat` handler; a `moveChat` helper that closes the chat and its workers, rewrites `byChat`, the subagent map and the claims, and spawns under the destination with `{ resume: <backend id>, seed: allTurns(), chatId: <backend id> }` and the chat's own folders.
- `UPDATE: packages/sdk/src/sessions.ts`, `packages/sdk/src/types/sessions.ts` - a `moveChat(from, to, uri)` on both stores that moves the chat's title, senders and its entry in host/50's chat list in one write.
- `UPDATE: packages/sdk/test/host-chats.test.ts`, `packages/sdk/test/sessions.test.ts` - the cases below, the host's in `more than one chat in a session`.
- `UPDATE: docs/AHP.md` - the `moveChat` row.

## Steps

1. Refuse with `-32602` and a sentence naming the difference when the destination's provider or `config.computer` is not the source's; the sentence says such a move is not supported yet (see [deferred.md](deferred.md)).
2. Move in memory and in the store first, then spawn the chat under the destination; if the spawn fails, spawn it back under the source and answer the error, so a failed move leaves the chat where it was.
3. Dispatch on the source session `session/chatRemoved`, on the destination `session/chatAdded` and `session/chatsReordered`, then both `summaryMoved`.
4. `newSession` allocates a session the way `createSession` does, with the source's provider, config and the chat's folders, its id the chat's backend id; the moved chat is its default chat under the chat's own URI, recorded `default: true`, and is not movable.
5. A worker chat keeps its `ahp-chat://subagent/<source>/<toolCallId>` URI; `chatOf` resolves it through the claim, never by parsing the session out of it.

## Validation

- `packages/sdk/test/host-chats.test.ts`, in `more than one chat in a session`: on a fake agent recording `Start`, chat B of session S1 moved after chat X of S2 is gone from S1's snapshot and catalogue row and sits after X in S2's, keeps its URI and turns, its new `Start` has `resume` and `chatId` equal to its backend id and B's own folders, and a turn sent on it runs; a worker of B moves with it and its URI still resolves; a move to a session of another provider, or of another `config.computer`, is refused and both sessions are unchanged; a spawn that throws leaves B in S1; `newSession` answers a new session URI whose `defaultChat` is B and whose row lists B without `movable`; after a new host over the same file store, B is rebuilt in S2, and the `newSession` session lists once.
- `packages/sdk/test/sessions.test.ts`: the file store's `moveChat` moves a title, a sender and the chat list entry, and a new store reads them under the destination.
- `packages/sdk/test/conformance.test.ts` and `pnpm test` pass.

## Resume
