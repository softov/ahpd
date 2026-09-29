---
title: "A forked chat says which chat and turn it came from - implemented"
date: 2026-09-28
refs:
  - git://373253e
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `madeFrom` and `startedBy`"
---

A chat made by forking another says which chat and turn it came from, and a side chat says it is one, in the chat list and in the chat's own state, while the daemon holds the session.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `madeFrom`, the origin per chat recorded by `createChat`, read by `startedBy` for `chatSummary` and the chat state; removed with the chat or session, kept on a restart.

## Verified

- `host.test.ts`, `a chat made out of another`: fork, side chat with selection, and a secondary chat under an alias spelling; all failed first reading `user`, and every frame validates with `checker`.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1532 tests passed.

## Departures from the plan

- `respell` was left as it is: a secondary chat's URI is already the client's own, and a fork of the default chat is already respelled; a test pins both.

## Left for later

- By hand: VS Code or ahpapp showing the fork as a fork.
- Actions to a connection watching a session alias are not respelled, only snapshots; this applies to every chat URI in an action.
