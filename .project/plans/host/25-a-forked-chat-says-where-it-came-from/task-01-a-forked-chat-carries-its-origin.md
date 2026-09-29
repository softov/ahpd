---
title: A forked or side chat carries its origin
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L782-L811](../../../../packages/sdk/src/host.ts#L782-L811) - `startedBy` and `chatSummary`"
  - "[code://packages/sdk/src/host.ts#L5349](../../../../packages/sdk/src/host.ts#L5349) - the chat channel's state"
  - "[code://packages/sdk/src/host.ts#L7226-L7311](../../../../packages/sdk/src/host.ts#L7226-L7311) - `createChat`, where the source is read"
  - "[code://packages/sdk/src/host.ts#L1520-L1535](../../../../packages/sdk/src/host.ts#L1520-L1535) - `spelledFor`'s `origin.chat` respelling"
  - "[code://packages/sdk/test/host.test.ts#L5489-L5521](../../../../packages/sdk/test/host.test.ts#L5489-L5521) - `a chat made out of another`"
---

## Objective

A chat made with a `fork` or `sideChat` source carries that origin wherever the host describes the chat, and the origin names the source chat in the spelling the client used.

## Files

- `UPDATE: packages/sdk/src/host.ts:7226-7311` - after the chat is made, record its origin in a per-session map beside `held.chats`, keyed by chat URI, and remove it when the chat or the session goes.
- `UPDATE: packages/sdk/src/host.ts:782-811` - `chatSummary` (or `startedBy` given the chat) uses the recorded origin when there is one.
- `UPDATE: packages/sdk/src/host.ts:5349` - the chat state uses the same.
- `UPDATE: packages/sdk/src/host.ts:1520-1535` - `respell` keeps a secondary chat's own URI, respelled for the client's session spelling, rather than mapping it to the default chat.
- `UPDATE: packages/sdk/test/host.test.ts` - the cases below.

## Steps

1. The recorded origin names the source chat as the host holds it; `spelledFor` respells it for each client.
2. The worker chats' `tool` origin is unchanged.

## Validation

- In `a chat made out of another`: the fork's `session/chatAdded`, a `session/chatUpdated` after a title change, the session snapshot and a subscribe to the new chat carry `{ kind: 'fork', chat, turnId: 't1' }`; the same for a side chat with `sideChat`; a fork of a secondary chat names that chat, under an aliased session spelling too; each fails first.
- Each validates with `checker` from `tools/wire.mjs`.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Built.
`createChat` records the new chat's origin in `madeFrom`, a map keyed by chat URI beside `byChat`, as `{ kind: 'fork', chat, turnId }` or `{ kind: 'sideChat', chat, turnId, selection? }`, naming the source chat by `chatOf` so it is the chat as this host holds it.
`startedBy(session, chat?)` reads that map first, so `chatSummary` (used by `session/chatAdded`, the full `session/chatUpdated` a moving chat re-sends, and the session snapshot) and the chat channel's own state all carry it.
The entry is removed where a chat is disposed and where a session is removed; a chat restart keeps it, because the chat is the same one.
A side chat's `selection` is kept only when it has a non-empty `text`, copying `text` and a string `responsePartId`, which is what `SideChatSelection` declares.

Tests, in `a chat made out of another` in `packages/sdk/test/host.test.ts`:

- `says a fork came from that chat at that turn, wherever the chat is described`: `session/chatAdded`, every `session/chatUpdated` for the fork that carries an origin (after a title change and a turn start), the session snapshot and a subscribe to the fork; the source chat still says `user`.
- `says a side chat came from that chat at that turn, with the selection it was given`: the same for `sideChat`, with `selection`.
- `names a secondary chat it was forked from as that chat, under any spelling of the session`: a fork of `ahp-chat:/other` and a fork of the default chat, read through a `claude:/` alias of the session; the first names `ahp-chat:/other`, the second names the default chat in the alias spelling.
- Each checks every frame the peer was sent and the subscribe answers with `checker` from `tools/wire.mjs`: no defects.

Failed first: all three new cases, each with `expected { kind: 'user' } to deeply equal { kind: 'fork' | 'sideChat', ... }`, because every chat was described as `user`.

Departure: `respell` in `spelledFor` was not changed.
Its `mine` test is true only for a chat URI derived from the session (the `default` authority, the `ahp-chat:/<session id>` spelling, or a worker's), and a secondary chat's URI is the client's own, so a fork of a secondary chat already keeps that chat's URI and a fork of the default chat is respelled to the default chat in the client's spelling.
The third test pins both.
Question for review: the plan expected a change there; confirm none is wanted.

Also found: actions sent to a connection watching a session alias are not respelled (only snapshots are), so a live `session/chatAdded` for a fork of the default chat names it in the held spelling, as worker `tool` origins already do.
Left as it is, since it applies to every chat URI in an action and is outside this task.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1532 tests passed.
