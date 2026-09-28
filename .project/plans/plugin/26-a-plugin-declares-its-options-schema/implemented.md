---
title: A plugin declares a schema for its options, and the loader checks it - implemented
date: 2026-09-28
refs:
  - git://c3c23d6
  - "[code://packages/sdk/src/types/plugin.ts](../../../../packages/sdk/src/types/plugin.ts) - `Plugin.optionsSchema`"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - `loadOne` checks the options before `apply`"
---

A plugin exports `optionsSchema`, and the daemon checks the configured options, with the plugin's `defaults` under them, before `apply` runs.
Options that fail are reported with the plugin, the key and what was expected, and the daemon starts without that plugin; an option key the schema does not name is reported and passed through.
Every plugin in this repository declares its schema, and their hand-written type checks are gone.

## What was built

- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `optionsSchema?: Record<string, unknown>`, plain JSON Schema, with no `@cofold/*` import in the SDK.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - the check with `@cofold/commands`' `check`, labelled `plugins.<name>.options`; only keys the configuration named are warned about.
- `optionsSchema` in agent-acp, agent-claude, agent-cofold, agent-pi, computer and tunnel-devtunnel, re-exported from each `index.ts`.
- [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md) - the export, with an example.

## Verified

- [`code://packages/server/test/plugin-options.test.ts`](../../../../packages/server/test/plugin-options.test.ts) (8 cases) and one `test/<package>-options.test.ts` per plugin, through the real loader.
- Softov checked on 2026-09-28: an invalid plugin option is reported and that plugin skipped.
- `pnpm typecheck` and `pnpm boundary` clean, full `pnpm test` 118 files and 1705 tests at `d0e9714`.

## Departures from the plan

- Keys that come only from a plugin's `defaults` are not warned about, because computer keeps constants there.
- pi's `projectTrust: "ask"` is refused where it used to become `trust`; an empty string now reaches `apply`, because `check` words `minLength` badly and the schemas do not use it.
- computer's `named` and `profilesOf` stay for the values inside maps, which cofold's schema cannot describe.

## Left for later

- The computer README lists 9 of its 18 options, and the `ahpd.options` manifests disagree with the schemas in tunnel-devtunnel, agent-acp, agent-pi and computer; agent-cofold has none. Noted in the handoff.
