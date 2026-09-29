---
title: "A daemon with no backend names the command that installs one, and an upgrade from 0.6 is told why - implemented"
date: 2026-09-28
refs:
  - git://5adac82
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - the refusal with the install command"
---

A daemon that starts with no backend names the command that installs Claude Code, with the same `--config-file` it was started with, and the docs say why an upgrade from 0.6 needs it.

## What was built

- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the refusal names `ahpd plugin install @ahpd/agent-claude`, then `npm i` as the other way.
- [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) - the sentence, and why 0.6 needed no plugin.

## Verified

- `daemon-backend.test.ts`: with and without `--config-file`; both failed first.
- Softov's 0.6.3 upgrade check on 2026-09-28: 0.8.0 refused with the command, served once the plugin was installed, and stopped the 0.6.3 background daemon.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1595 of 1596, the one failure the agent-cofold-tools race that plugin/27 fixed.

## Departures from the plan

- none.

## Left for later

- Session state written by 0.6 read by 0.8 was not exercised.
