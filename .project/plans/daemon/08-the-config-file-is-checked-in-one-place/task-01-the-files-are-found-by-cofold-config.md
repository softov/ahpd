---
title: The configuration files are found and merged by @cofold/config
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/config.ts#L204-L226](../../../../packages/server/src/config.ts#L204-L226) - `loadConfig`, replaced by a call to `resolveConfig`"
  - "[code://packages/server/src/commands/user.ts#L67](../../../../packages/server/src/commands/user.ts#L67) - reads the file"
  - "[code://packages/server/src/commands/config.ts#L85-L95](../../../../packages/server/src/commands/config.ts#L85-L95) - `ahpd config` prints what was read"
  - "[code://packages/server/src/commands/run.ts#L204](../../../../packages/server/src/commands/run.ts#L204) - the startup names the file"
---

## Objective

The daemon reads the user file and the file `$AHPD_CONFIG` names, merged in that order, and no project file; `--config-file` reads that file alone. Every reader of the configuration gets the same merged values and knows which file set each key.

## Files

- `UPDATE: packages/server/package.json` - depends on `@cofold/config` at the release that carries cofold commands/02.
- `UPDATE: packages/server/src/config.ts:204-226` - `loadConfig(named?)` returns `{ values, files, sourceOf }` from `resolveConfig`, with the layers in the plan's architecture; relative paths in `paths`, `users`, `connectionTokenFile` and a plugin path spec resolve against the directory of the file that set them.
- `UPDATE: packages/server/src/commands/options.ts:312-360` - `optionsFrom` reads the merged values.
- `UPDATE: packages/server/src/commands/user.ts:67`, `packages/server/src/commands/config.ts:85-95` - the same reader; `ahpd config` lists every file read and, per key, where it came from.
- `UPDATE: packages/server/src/commands/run.ts` - the startup names each file read.
- `UPDATE: docs/DAEMON.md` - the layers, their order, and `$AHPD_CONFIG`.

## Steps

1. Tests first, with `XDG_CONFIG_HOME`, the working directory and `AHPD_CONFIG` set per case.
2. Replace `loadConfig`'s body; keep its callers' shapes where they only need values.
3. `plugin install`, `plugin remove` and `user add` keep writing the user file, or the named one.

## Validation

- `packages/server/test/config-layers.test.ts`: a user file alone; `$AHPD_CONFIG` merged over it; an `ahpd.json` and a `.ahpd.json` in the working directory ignored; `--config-file` with the others present reads only the named one; a relative `paths` entry in the `$AHPD_CONFIG` file resolves against that file's directory.
- `ahpd config` prints each file and which file set `port`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Dependency, a placeholder until cofold is published:** `@cofold/config` is not released, so [`code://packages/server/package.json`](../../../../packages/server/package.json) depends on it as `"@cofold/config": "link:/github/.worktrees/cofold-config-layers/packages/config"` (the cofold worktree's built `dist`, version 0.2.0 in its `package.json`). `link:` in the package worked with `pnpm typecheck` and `pnpm boundary`, so no root override was needed. The only two changes the link makes are that line and the matching `importers.packages/server.dependencies['@cofold/config']` entry `pnpm install` wrote to `pnpm-lock.yaml` (`specifier: link:...`, `version: link:../../../cofold-config-layers/packages/config`). After the release both become `^<version>` and `pnpm install` rewrites the lock entry.
- **Changed:** [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts) `loadConfig(named?)` returns `{ values, files, sourceOf }` from `resolveConfig`. Without a name it passes `{ name: 'ahpd', env }`, which reads the user file then `$AHPD_CONFIG`, with no `project`, so no project file is read. With a name it passes `{ name: 'ahpd', path, user: false, environment: false }`. `env` carries ahpd's own `configHome()` as `XDG_CONFIG_HOME`, so an empty variable still falls back to `~/.config` as it did. A resolver error is rethrown as a plain `Error` with the resolver's sentence, so the exit code (1) does not depend on which copy of `@cofold/commands` threw it. `anchored` makes `paths` entries, `users`, `connectionTokenFile`, and a plugin spec starting with `.` (string or `name`) absolute against the directory of the file `sourceOf` names. It leaves wrong types alone for the schema to refuse.
- **Readers:** `optionsFrom` labels every error and warning with `loaded.sourceOf(key)`, the file that set the key; the one-file stub from task 02 is gone. `Options.configFiles` lists the files read. `user.ts` reads `.values` from the same reader. `ahpd config` prints every file read (the path it would read when none was), then each key and value, with ` (<file>)` after each key when more than one file was read; `--json` adds `files` and `sources` beside `path` and `config`. Served, it reads the daemon's own `options.configFile`. The startup block gains `config <file>, <file>` (or `config none`) after the `plugins` line. `plugin install`/`remove` and `user add` are unchanged and still write the user file or the named one.
- **Behaviour change, and the tests it moved:** a relative plugin spec in a file named with `--config-file` used to be tried against the working directory. It is now taken from the file's directory. Four tests wrote the cwd-relative `./packages/server/test/fixtures/plugin-echo` into a temporary config file, and now name it absolutely: `server-http.test.ts` and `server-cli.test.ts` (`BACKEND`), `daemon-backend.test.ts` (two specs), and `packages/sdk/test/container-relay.test.ts` (`CONFIG`). The same holds for relative `paths`, `users` and `connectionTokenFile`. In the user file, a relative plugin spec now means the configuration directory, which was already the loader's fallback.
- **Tests:** [`code://packages/server/test/config-layers.test.ts`](../../../../packages/server/test/config-layers.test.ts), 14 cases:
  - the layers: the user file alone; no file (`files` empty, defaults); `$AHPD_CONFIG` merged over it with `sourceOf` per key; a `$AHPD_CONFIG` naming nothing refused; `--config-file` with both others present reads only itself.
  - relative paths: in the `$AHPD_CONFIG` file, relative `paths`, `users`, `connectionTokenFile` and plugin specs resolve against its directory, while bare and absolute specs are left alone; in the user file, relative `paths` resolve against the configuration directory; typed `--path` is left alone.
  - wrong values and unknown keys: a wrong value in the `$AHPD_CONFIG` file names that file (the case task 02 left); a wrong value in the user file names the user file under a `$AHPD_CONFIG` that set another key; an unknown key names the file holding it.
  - processes: `ahpd config --json` run in a directory holding `ahpd.json` and `.ahpd.json` reads only the user file; `ahpd config` prints both files and the file that set `port`; a `--stdio` run's startup says `config <user>, <env>`.
- **Failed first, for the right reason:** 12 of 14 failed against the one-file reader. `files`/`configFiles` were `undefined`, `$AHPD_CONFIG` was not read (port 1111, not 2222; a missing one did not throw; its wrong value was accepted), relative paths stayed relative, `ahpd config` printed one path, and the startup had no `config` line. The project-file case failed on the missing `files` field; the old reader never read a project file either, so it is a guard. Two passed as guards: typed paths left alone, and the user-file wrong value (the stub already named the user path).
- **Docs:** [`docs/DAEMON.md`](../../../../docs/DAEMON.md) Configuration says the two layers and their order, that `$AHPD_CONFIG` must exist, how objects merge and lists replace, that no working-directory file is read, that `--config-file` reads that file alone, how relative paths resolve, the `config` startup line, and what `ahpd config` prints.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, `@ahpd/server` 7 declared, none undeclared). Full `pnpm test`, 118 files, 1705 tests: the last two runs each had one failure, the known flake `packages/agent-acp/test/agent-acp-ports.test.ts > advertises exactly the ports it was given, and nothing more`, which passed 3 of 3 alone. An earlier run also hit the other known flake, `agent-cofold-tools.test.ts`, which passed alone.
