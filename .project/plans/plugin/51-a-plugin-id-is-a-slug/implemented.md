---
title: A plugin id is a slug - implemented
date: 2026-10-16
refs:
  - git://e6417811
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
  - "[code://packages/sdk/src/utils/values.ts](../../../../packages/sdk/src/utils/values.ts)"
  - "[code://packages/sdk/src/usage/usage.ts](../../../../packages/sdk/src/usage/usage.ts)"
  - https://github.com/softov/ahpw/blob/main/plugin/index.ts - ahpw exports `web`, in ahpw commit `e500c19`
---

Every plugin id is a slug: lowercase letters, digits and dashes, one to forty of them, with a letter first.
The first-party plugins are `agent-acp`, `agent-claude`, `agent-cofold`, `agent-pi`, `bot`, `computer`, `push`, `tunnel-devtunnel`, `webhook`, and ahpw's `web`.
A route is `/plugins/webhook/`, an owner is `plugin:webhook`, and a root config key is `plugins.agent-claude`.
The daemon skips a plugin whose id is not a slug, and the listing shows that plugin as `error`.
Work saved under an old owner such as `plugin:@ahpd/bot` reads as `plugin:bot`, and nothing on disk is rewritten.

## What was built

- Each first-party `plugin.ts` and [`code://packages/webhook/src/route.ts`](../../../../packages/webhook/src/route.ts) export the slug, in `a8e998bb`.
- [`code://packages/server/test/plugin-ids.test.ts`](../../../../packages/server/test/plugin-ids.test.ts) - one case for each of the nine first-party plugins.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `loadOne` skips an exported name that is not a slug, in `5a6fbdf4`. `unscoped` makes a fallback `@scope/name` into `scope-name`, and `loadOne` checks every id, in `80562f9d`. `describePlugin` lists an id that is not a slug as `error`, in `e6417811`.
- [`code://packages/sdk/src/utils/values.ts`](../../../../packages/sdk/src/utils/values.ts) - `currentOwner` reads `plugin:@ahpd/<x>` as `plugin:<x>` and `plugin:ahpd-web` as `plugin:web`, and `ownerOf` reads through it, in `11e4df4f`.
- [`code://packages/sdk/src/usage/usage.ts`](../../../../packages/sdk/src/usage/usage.ts) - `entriesIn` reads a line's owner and pools through `currentOwner`, in `11e4df4f`. A read by pool name reads the name through it too, in `e6417811`.
- [`code://packages/sdk/src/automations/triggers.ts`](../../../../packages/sdk/src/automations/triggers.ts) - a trigger's `owners` filter compares through `currentOwner`, in `11e4df4f`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) and [`code://docs/plugins/WEBHOOKS.md`](../../../../docs/plugins/WEBHOOKS.md) - the slug rule, the first-party ids and the new routes.
- ahpw commit `e500c19` - the plugin exports `web` and serves its page under `/plugins/web/`.

## Verified

- `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s schema` pass after each task.
- After task 07, the test gate passes with 5105 tests, and agent-cofold, agent-pi and tunnel-devtunnel pass with 444 tests.
- In ahpw, `pnpm typecheck` passes, and `pnpm test` passes with 282 tests.
- Task 06 found no reader to change, so its gates are those of task 05.
- The checks by hand passed. The webhook, the scope and the page under `/plugins/web/` passed on 2026-10-20, and the old owner on 2026-11-03.
- The sign-in of ahpw under its slug passed on 2026-11-09, on a Debian 13 test VM. The check was `pending/linux-checks.md`, last held at git://45983f869.

## Departures from the plan

- Two cofold tests keep `@ahpd/agent-cofold` after task 01, because their module exports no `name`. Task 05 then changed the fallback id to `ahpd-agent-cofold`.
- The 409 case in the server `webhook-bot.test.ts` checks for a line that starts with `webhook: `, because the old check matched the id inside the line.
- The whole-segment case in `plugin-route.test.ts` checks that the old path `/plugins/%40ahpd/plugin-route/hook` answers 404.
- Task 03 added a `triggers.test.ts` case, because the trigger filter had no test for an old owner.
- Task 06 changed no code: a trigger's `owners` filter is the only written configuration that takes `plugin:`, and task 03 already reads it through `currentOwner`.
- A read of `usage://plugin%3A%40ahpd%2Fbot` answers `pool: "plugin:bot"`, the id, and not the name that the reader gave.

## Left for later

- none.
