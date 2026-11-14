---
title: A bot talk needs no grant - implemented
date: 2026-11-14
refs:
  - "[code://packages/sdk/src/host/trust.ts](../../../../packages/sdk/src/host/trust.ts) - `mayTrust`, the one trust check"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts) - `ownAgentExcused`, the one gate excuse"
  - "[code://packages/sdk/src/plugins/plugins.ts](../../../../packages/sdk/src/plugins/plugins.ts) - `registerFolder`"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - the bot plugin registers its root"
---

A talk with a bot works with no grants on the bot plugin's entry, on a host with or without users. The bot's folder is trusted for its talks only, and the bot plugin reads and writes only sessions of its own agent without a grant.

## What was built

- [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts) - `registerFolder(path)`, which needs `contracts.folders` and an absolute path, and is refused for a plugin with no contracts.
- [`code://packages/sdk/src/host/trust.ts`](../../../../packages/sdk/src/host/trust.ts) - `mayTrust`: the plugin's `session:trust`, or a folder under one it registered, compared once links are followed.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) and [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - both trust checks call `mayTrust`.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - `ownAgentExcused`, which the action gate and the command gate ask for each `session:` and `chat:` grant.
- [`code://packages/bot/package.json`](../../../../packages/bot/package.json) and [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - `contracts.folders`, and `registerFolder` on the root.
- [`code://packages/sdk/test/plugin-own-sessions.test.ts`](../../../../packages/sdk/test/plugin-own-sessions.test.ts) - the gate's four cases.
- Docs: PLUGINS.md, BOTS.md, AGENT.md, USERS.md and the bot README.

## Verified

- `pnpm typecheck`, `pnpm boundary` and `pnpm i18n` are clean.
- `TMPDIR=/tmp npx vitest run packages/sdk`: 240 files, 4801 tests passed.
- `packages/bot`: 14 files, 265 passed. `packages/webhook`: 8 files, 124 passed.
- `packages/server`: 96 files, 1846 passed, after `schema-gaps.test.ts` was given the manifests' contracts.
- `packages/computer`: 631 passed and 2 timed out at 5 s in the full run, and both pass alone. They are added to the problem file on main.
- With the folder rule turned off, the own-folder bot case fails with "plugin:bot may not session:trust here".
- With the gate rule turned off, two of the four gate cases and one bot-provider case fail.

## Departures from the plan

- Task 02 also changed `schema-gaps.test.ts` and `webhook-bot.test.ts`, which the plan did not name.

## Left for later

- None.
