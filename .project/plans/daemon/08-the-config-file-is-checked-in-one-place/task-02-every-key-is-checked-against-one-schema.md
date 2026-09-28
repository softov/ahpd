---
title: Every configuration key is checked against one schema
status: done
depends: [task-01-the-files-are-found-by-cofold-config.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L111-L205](../../../../packages/server/src/commands/options.ts#L111-L205) - `serverFields`, the schemas the check uses"
  - "[code://packages/server/src/commands/options.ts#L262-L303](../../../../packages/server/src/commands/options.ts#L262-L303) - `said`, `under`, `isOneOf`, `httpOf`, which go"
  - "[code://packages/server/src/config.ts#L28-L130](../../../../packages/server/src/config.ts#L28-L130) - `Config`, which becomes the schema's type"
  - "[code://.project/decisions/http-host-binds-the-apis-own-listener.md](../../../decisions/http-host-binds-the-apis-own-listener.md) - `http.host` without `http.port` stays refused"
---

## Objective

The merged configuration is checked once against an object schema made of `serverFields`, `http` and `updateCheck`. A wrong value on a known key refuses the start with `<file>: <key> must be ...`; an unknown key prints `<file>: <key> is not a setting ahpd knows; ignored` and the daemon starts.

## Files

- `UPDATE: packages/server/src/commands/options.ts:111-205` - `http` joins `serverFields` as an object field with `port` (integer 0-65535) and `host` (non-empty string), and no CLI spelling.
- `UPDATE: packages/server/src/commands/options.ts:262-388` - a `configSchema` built from the fields; `optionsFrom` checks the file values with `check` from `@cofold/commands`, labelling with `sourceOf(key)`, then folds flags over file over defaults with no per-key type tests. `said`, `isOneOf` and `httpOf` are removed; the `http.host`-needs-`http.port` rule stays as the one cross-key check.
- `UPDATE: packages/server/src/config.ts:28-130` - `Config` is the schema's type, or checked against it in a type test.
- `UPDATE: docs/DAEMON.md` - what a wrong value and an unknown key do.

## Steps

1. Tests first, one per key kind: integer, string, enum, boolean, string array, `http`, `plugins`.
2. Build the schema from `serverFields` so a new flag is checked in the file without another edit.
3. Unknown keys are the object's properties not in the schema, warned through the startup's own line writer.

## Validation

- `packages/server/test/config-check.test.ts`: `"port": "8080"`, `"automations": "disk"`, `"paths": "/work"` and `"http": { "port": 70000 }` each refuse the start naming the file and key; `"plugin": []` warns and starts; a valid file of every key starts; a wrong value in the `$AHPD_CONFIG` file names that file.
- `packages/server/test/daemon-backend.test.ts` still passes.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Built over one file, ahead of task 01:** task 01 waits for a cofold release, so this reads through the current `loadConfig` (the `--config-file` path, or `configPath()`). Every error and warning is labelled by `sourceOf(path)(key)` in [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts), one small function that answers the one file read; task 01 replaces it with cofold's `sourceOf`, and `checkConfig(file, source)` already takes the label as an argument.
- **Changed:** `http` is in `serverFields` (`type: ['object', 'boolean']`, `port` integer 0-65535, `host` string matching `^\S+$`). `flagFields` is `serverFields` without `http`, and every command (`run`, `start`, `stop`, `status`, `config`, `plugin`) takes `flagFields` as its input, so `http` has no flag. `configSchema` is built from `serverFields` without `stdio`, `configFile` and `noPlugins` (flags only, not in `Config`), with `plugins` items widened to a string or `{ name, options, enabled }`. `checkConfig` runs `check` from `@cofold/commands` per key and stops with `<file>: <key> must be ...`, or returns `<file>: <key> is not a setting ahpd knows; ignored`. `optionsFrom` folds flag over file over default with `??` and no `typeof`; `said`, `under` and `isOneOf` are gone, and `httpOf` is only `true`/`false` mapping plus the `http.host`-needs-`http.port` refusal, now labelled with the file. `Options.warnings` carries the lines: `runForeground` stamps them first, and `start` prints them above its own line.
- **Behaviour changes:** a flag now beats the file for the booleans too (`--trust-token=false` over `"trustToken": true`), where before either `true` won. `"port": null` and other wrong values that used to fall back to the default now refuse. `http.host` with space around it is refused with `http.host must be text matching ^\S+$` instead of the old `must name an address` sentence; the two `server-cli.test.ts` cases were updated to it. `stdio`, `configFile` and `noPlugins` in the file now warn instead of being silently ignored.
- **Config:** kept as the documented interface; [`code://packages/server/test/config-check.test.ts`](../../../../packages/server/test/config-check.test.ts) holds `expectTypeOf<keyof Config>().toEqualTypeOf<ConfigKey>()`, which `pnpm typecheck` enforces (checked by adding a stray key to `Config`: tsc failed naming it).
- **Tests:** `config-check.test.ts`, 23 cases: integer, string, enum, boolean, string list, `http.port` range, `http` type, `http.host`, `http.host` without `http.port`, three `plugins` entry shapes, `updateCheck` as a string; unknown key warned with the rest read, a flag-only key warned, `constructor` as a key; a valid file of every key; `http` true/false; flag over file; defaults; the schema built from the flags; `http` not a flag; the `Config` type test; and two processes, one starting with `"plugin": []` and its warning on stderr, one exiting 2 on `"port": "8080"`.
- **Failed first, for the right reason:** with `configSchema` and `flagFields` stubbed as empty exports, 20 of 23 failed: each wrong value was accepted (`{"port":"8080"} was accepted`), the `http` sentences had no file, `warnings` was `undefined`, a typed `trustToken: false` lost to the file's `true`, and the daemon exited 0 on `"port": "8080"`. The three that passed guard existing behaviour: `http.host` without `http.port`, `http` true/false, and the type test (runtime no-op; its tsc half is the check above).
- **Not done here:** the `$AHPD_CONFIG` case in Validation needs task 01. `user.ts` and `ahpd config` still read the file unchecked; `ahpd config` prints it as it stands.
- **Docs:** [`docs/DAEMON.md`](../../../../docs/DAEMON.md) Configuration says what a wrong value and an unknown key do, and that the three flag-only keys warn.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared); full `pnpm test` 117 files, 1691 tests passed. The first full run had one failure, `packages/sdk/test/changes-refresh.test.ts > re-reads a changeset when git is changed outside the host`, which passed 3 of 3 alone and on the second full run.
