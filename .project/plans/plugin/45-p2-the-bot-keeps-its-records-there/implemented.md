---
title: The bot keeps its records in the record store - implemented
date: 2026-10-11
refs:
  - git://cd1fbb9 - the last commit of the build, released in 0.11.0
  - "[code://packages/bot/src/store.ts](../../../../packages/bot/src/store.ts) - `botStore` over the `bots` and `bots-gone` collections"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - opens both collections with `host.records`"
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - waits for the store, and tells watchers on `onChange`"
---

A bot is a Markdown file in `<configDir>/bots/<slug>.md`, with its instructions as the body.
A bot file from an earlier version is converted when the daemon starts, and the original is kept as `<slug>.json.migrated`.
A person can edit a bot file, and the provider, its watchers and the catalogue see the change without a restart.

## What was built

- [`code://packages/bot/src/store.ts`](../../../../packages/bot/src/store.ts) - `botStore(bots, graves, onProblem)`, with a cache that `ready()` loads once, a tombstone per deleted slug, and a watch on `bots`. A hand edit that changes the owner or the workspace is refused, and a write that changes nothing is skipped.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - `host.records('bots', {body: 'instructions'})` and `host.records('bots-gone')`.
- [`code://packages/bot/src/provider.ts`](../../../../packages/bot/src/provider.ts) and [`code://packages/bot/src/catalogue.ts`](../../../../packages/bot/src/catalogue.ts) - wait for `ready()`, and update on `onChange`.
- `docs/plugins/BOTS.md` and `packages/bot/README.md` describe the file, the conversion and the rules for a hand edit.

## Verified

- `pnpm -s typecheck` and `pnpm -s boundary` pass.
- `pnpm exec vitest run packages/bot` passes 78 tests in 5 files.
- `rg -n "node:fs" packages/bot/src/store.ts` finds nothing.
- A copy of the five bots in `~/.config/ahpd/bots` converted with every field the same. Each gains `instructions: ''`, and an empty prompt opens a silent session, as before.
- After the restart on 2026-10-11, the five real bots converted and show in the clients.
- On 2026-11-04 Softov checked by hand: a hand edit of a bot's description shows in ahpw without a restart. A deleted bot leaves the list.

## Departures from the plan

- Tasks 01 and 02 are one commit, because both change the same functions in `store.ts` and `provider.ts`.
- `packages/bot/test/bot-docs.test.ts` is a test no task named. It checks that the docs name the file and the conversion.

## Left for later

- none.
