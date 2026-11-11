---
title: Agents and connectors list their alerts - implemented
date: 2026-11-10
refs:
  - git://f4fde1e60
  - "[code://packages/sdk/src/types/plugin.ts](../../../../packages/sdk/src/types/plugin.ts)"
  - "[code://packages/sdk/src/plugins/alerts.ts](../../../../packages/sdk/src/plugins/alerts.ts)"
  - "[code://packages/sdk/src/channels/owners.ts](../../../../packages/sdk/src/channels/owners.ts)"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
  - "[code://packages/sdk/src/agents/channel.ts](../../../../packages/sdk/src/agents/channel.ts)"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts)"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md)"
---

An agent row and a connector row now list each of their problems as its own alert, with the time the host raised it. A plugin row's alerts carry that time too. A record that fits its schema but does not open is `failed`, and its alerts say which variable, secret or open failed. `invalid` now means only a config that does not fit.

## What was built

- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `Alert.at`, an optional ISO time that the host sets when the plugin did not.
- [`code://packages/sdk/src/plugins/alerts.ts`](../../../../packages/sdk/src/plugins/alerts.ts) - `alertList(limit)`, one list keyed by `ref`, which replaces, drops, clears and keeps the newest.
- [`code://packages/sdk/src/channels/owners.ts`](../../../../packages/sdk/src/channels/owners.ts) - `RecordGaps`, which holds every missing variable and secret, thrown once when the walk ends.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - each plugin's alerts live in the shared list, and `alerts()` answers a copy.
- [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts) - an `alertList` per id, the state `failed`, `env:`, `secret:`, `open` and `probe` alerts, and a row that serves `alerts`.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - an `alertList` per id and the last check result apart from it. The states are `failed` and `unauthorized`, the alerts `check` and `call`, and the row serves `alerts`.
- [`code://packages/sdk/src/types/index.ts`](../../../../packages/sdk/src/types/index.ts) - `AgentHealth` and `ConnectorHealth` are gone.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - the release notes name `alerts` in place of `health` on both rows.

## Verified

- `packages/sdk`: 4705 passed, 5 skipped, and 2 failed in `host-permissions.test.ts`, which need a tmpdir outside the home. The suites ran without `TMPDIR` because the harness denied every prefix.
- `packages/server`: 1871 passed and 3 skipped.
- `pnpm exec tsc -p tsconfig.json --noEmit` passed.
- `packages/sdk/test/fixtures/wire.jsonl` was unchanged after both suites.
- The agent and connector tests cover each case in the tasks' *Validation*. They also cover the plan's checklist: two `env:` alerts, and a probe alert beside a gap. A `call` alert cleared by a good call is covered, as is a row with no `health`.

## Departures from the plan

- Three server plugin alert tests compare `alerts()` exactly, so they now expect `at: expect.any(String)`. Task 01's line that they pass unchanged was wrong. The plugin row still maps only `level`, `text` and `ref`, because its file was not in task 01's *Files*.
- `alertList` holds at most 50 alerts in both channels, the same number as the server's `MAX_ALERTS`. The plan does not give a number.
- A connector whose open fails and whose config does not fit stays `invalid`, and still raises an `open` alert. A failed open is one thing to fix.
- `resolved` walks a nested array in order rather than with `Promise.all`. The gaps come out in config order, and the message stays the first gap's text.

## Left for later

- ahpw's agent and connector pages read `health`, and change to `alerts` in its own plan, which ships in the same release.
- Comments that still say `health` in `packages/sdk/src/connectors/probe.ts`, `packages/agent-claude/src` and `packages/server/src/proxy/listener.ts` are outside the tasks' *Files*, and wait for a change that edits them.
