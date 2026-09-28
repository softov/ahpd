---
title: The configuration is read through cofold and checked against one schema - implemented
date: 2026-09-28
refs:
  - git://d0e9714
  - git://c3c23d6
  - npm://@cofold/config@^0.3.0 - `resolveConfig` with `user`, `project` and `environment`, released from cofold `c7835d6`
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - `loadConfig`, `LoadedConfig` and `anchored`"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - `configSchema`, `checkConfig`, `flagFields` and `optionsFrom`"
---

The daemon reads the user file and the file `$AHPD_CONFIG` names, merged in that order, through `@cofold/config`, and no file from the working directory; `--config-file` reads that file alone.
Every key is checked against one schema built from the flag fields: a wrong value stops the start naming the file that set it and the key, and an unknown key is named and the daemon starts.

## What was built

- [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts) - `loadConfig(named?)` returns the merged values, the files read and `sourceOf`; relative `paths`, `users` and `connectionTokenFile` resolve against the directory of the file that set them.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `http` is a field with no flag, `flagFields` is what commands take, `configSchema` is the file's schema, `checkConfig` refuses or warns, and `optionsFrom` folds flag over file over default with no per-key type tests.
- [`code://packages/server/src/commands/config.ts`](../../../../packages/server/src/commands/config.ts) - `ahpd config` lists every file read and which file set each key; the startup block has a `config` line.
- [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) - the layers, their order, `$AHPD_CONFIG`, relative paths, and what a wrong value and an unknown key do.

## Verified

- [`code://packages/server/test/config-check.test.ts`](../../../../packages/server/test/config-check.test.ts) (23 cases) and [`code://packages/server/test/config-layers.test.ts`](../../../../packages/server/test/config-layers.test.ts) (14 cases).
- Softov checked on 2026-09-28: invalid keys refuse or warn as documented, and two configuration files merge with `ahpd config` naming both.
- `pnpm typecheck` and `pnpm boundary` clean, full `pnpm test` 118 files and 1705 tests at `d0e9714`.

## Departures from the plan

- The project file: the plan first read `ahpd.json`, then [the daemon reads no project config file](../../../decisions/the-daemon-reads-no-project-config-file.md) superseded that before building.
- A relative plugin spec keeps the loader's rule, the working directory and then the configuration directory, after anchoring it to the file's directory broke `./packages/...` entries in Softov's user file (`d0e9714`).
- A typed flag now beats the file for booleans too, and `stdio`, `configFile` and `noPlugins` in a file are warned about as unknown keys.

## Left for later

- Nothing from the plan. The plugin options half is [plugin/26](../../plugin/26-a-plugin-declares-its-options-schema/plan.md).
