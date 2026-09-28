---
title: A forked or side chat carries its origin
status: todo
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
