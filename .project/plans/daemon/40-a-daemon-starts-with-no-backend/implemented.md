---
title: A daemon starts with no backend - implemented
date: 2026-10-26
refs:
  - git://0b5a6b4d - the merge of PR #100
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `createHost` and the fold take an empty agent list"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - the start logs the no-backend line and goes on"
  - "[code://packages/server/src/pluginschannel.ts](../../../../packages/server/src/pluginschannel.ts) - `x-ahpd/plugins/update`"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - the refusals that name the fix, and `rootsOf`"
---

A daemon whose plugins load no backend now starts. It lists no agent and refuses each session create with `-32002` until a plugin adds one. The log and each refusal of an old plugin name `ahpd plugin update all`. A client moves one plugin with `x-ahpd/plugins/update`. The first-party plugins require `@ahpd/sdk >=0.14 <1`. With `AHPD_PLUGIN_ROOT` set, a bare name loads from the plugin root first.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - no throw on an empty agent list; `ctx.first` is read live and may be absent.
- [`code://packages/sdk/src/host/common.ts`](../../../../packages/sdk/src/host/common.ts) - `NO_AGENT`, the refusal a host with no agent gives.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the no-backend line names the update when plugins were configured, and the install when none were.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `OLDER_RELEASE` in the three refusals, and the plugin root before the configuration directory.
- [`code://packages/server/src/pluginschannel.ts`](../../../../packages/server/src/pluginschannel.ts) - `updateMethod`, with the grant `plugin:install`.
- [`code://docs/server/UPGRADE.md`](../../../../docs/server/UPGRADE.md) - an update by npm alone, and from 0.12.
- [`code://.project/decisions/the-daemon-bundles-no-agent-and-starts-without-one.md`](../../../../.project/decisions/the-daemon-bundles-no-agent-and-starts-without-one.md) - replaces `the-daemon-bundles-no-agent`.

## Verified

- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`: 7048 passed, 29 skipped.
- New cases in `host-replace.test.ts`, `daemon-backend.test.ts`, `plugins-channel.test.ts`, `plugin-compat.test.ts` and `plugin-resolve.test.ts`.
- CI on PR #100 and on `main` after the merge passed.
- The checks by hand ran on main on 2026-11-03. The start passes. The update from a client fails, see [the problem](../../../problems/a-client-cannot-update-a-scoped-plugin-that-failed-to-load.md).

## Departures from the plan

- Task 03 - the update cases are in `plugins-channel.test.ts`, not in a new file, because the fake npm is there.
- Task 05 - added during the build, from the desk report of 2026-10-26. It closed the problem `an-old-plugin-in-the-config-hides-the-one-in-the-plugin-root`.
- `computer-devcontainer.test.ts` - a case that pinned the daemon at 0.10.4 now pins 0.14.4, because the new range refuses 0.10.

## Left for later

- None.
