---
title: An owed answer is keyed by its chat
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts#L751-L812](../../../../packages/sdk/src/host.ts#L751-L812) - the owed answers and the lookups that read them"
  - "[code://packages/sdk/src/host/chatactions.ts#L310-L319](../../../../packages/sdk/src/host/chatactions.ts#L310-L319) - the chat a client action is about"
---

## Objective

An answer the host owes a client is held under the chat the dispatch is about, the action's type and the id it names.
Two chats that use one id each get their own answer, and a refusal in one chat lets go of that chat's answer alone.

## Files

- `UPDATE: packages/sdk/src/host.ts:751-812` - `owedKey` takes the chat; `chatAbout` names the chat a channel's dispatch is about; `owedUnder`, `answering`, `originOf` and `answeredBy` take the channel.
- `UPDATE: packages/sdk/src/host.ts:877-890` - a turn's end lets go of what it owed in its own chat.
- `UPDATE: packages/sdk/src/host.ts:1003-1040` - `refuse` and `echoTo` pass the channel they answer on.
- `UPDATE: packages/sdk/src/host.ts:1208` - `owe` keys the dispatch by the chat it is about.
- `UPDATE: packages/sdk/src/host/context.ts:333-348` - `answering` takes the channel, and both docs say the chat.
- `UPDATE: packages/sdk/src/host/spawn.ts:1204-1206` - `Start.handed` looks the dispatch up in its own chat.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - two chats start turn `t1` before either backend begins one.

## Steps

1. Add the chat to `owedKey`, first, as `opKey` puts the channel first.
2. Add `chatAbout`, which reads a chat channel as itself and a session channel as its default chat.
3. Pass the channel to `owedUnder`, `answering`, `originOf` and `answeredBy`, and key by `chatAbout(channel)`.
4. Make `owe` key the dispatch it holds by `chatAbout` of that dispatch's channel.
5. Pass the channel from `dispatch`, `refuse`, `echoTo` and `Start.handed`.
6. Write a test: two chats start turn `t1`, and a gated backend begins both turns once the host owes both.

## Validation

- `packages/sdk/test/echo-origin.test.ts`: each chat's `chat/turnStarted` carries its own `clientSeq`; before the change, chat one's carries chat two's.
- `packages/sdk/test/host-snapshots.test.ts`: a turn started on the session's channel still gets its echo's origin.
- `pnpm typecheck` exits 0.

## Resume

Done 2026-11-01 in `35a74788`; [implemented.md](implemented.md) says what was verified.
