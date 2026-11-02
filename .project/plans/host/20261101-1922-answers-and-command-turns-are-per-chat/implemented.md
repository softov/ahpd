---
title: Owed answers and command turns are held per chat - implemented
date: 2026-11-01
refs:
  - git://35a74788
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

An answer the host owes a client, and a `!` command's turn, are held under the chat as well as the id the client chose.
Two chats that use one turn id each get their own echo and keep their own read bit.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `owedKey` takes the chat, and `chatAbout` names the chat a dispatch on a channel is about.
- `owedUnder`, `answering`, `originOf` and `answeredBy` take the channel, and `owe` keys the dispatch it holds by its chat.
- [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) - `answering` takes the channel; `commandTurns` says its key.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `Start.handed` looks a dispatch up in its own chat, and a command turn reads its own chat's key.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `commandTurnKey(chat, turn)`, beside `startsRead`.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - a command turn is held under its chat.

## Verified

- `echo-origin.test.ts`: two chats start turn `t1` before a gated backend begins either. Each echo carries its own `clientSeq`.
- On `39d1f22a` that case fails: chat one's echo carries chat two's `clientSeq` 4.
- `host-terminals.test.ts`: two sessions run command turn `t1`, one long and one short, and all four channels end read.
- On `39d1f22a` that case fails: the long one's session ends unread.
- `host-snapshots.test.ts`: a turn started on the session's channel keeps its echo's origin.
- Seven test files near these maps pass, 208 tests, with one exception: a `nested-proxy.test.ts` case times out at 5 s.
- Run alone, that file times out one case on `39d1f22a` as well, a different one each run, at a load average of 5 to 8.
- `pnpm typecheck` exits 0.

## Departures from the plan

- none.

## Left for later

- none.
