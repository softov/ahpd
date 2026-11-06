---
title: Update checks and refuses
status: done
depends:
  - task-01-the-update-finds-its-install-place.md
layer: server
refs:
  - "[code://packages/server/src/commands/restart.ts#L683-L719](../../../../packages/server/src/commands/restart.ts#L683-L719) - `daemon.restart`, the declaration to mirror"
  - "[code://packages/server/src/commands/restart.ts#L98-L114](../../../../packages/server/src/commands/restart.ts#L98-L114) - `FOREGROUND`, `busy` and `notRestartable`"
  - "[code://packages/server/src/update.ts#L48-L68](../../../../packages/server/src/update.ts#L48-L68) - `newer` and `registry`"
  - "[code://packages/server/src/commands/registry.ts#L56-L76](../../../../packages/server/src/commands/registry.ts#L56-L76) - `cliRegistry`"
  - "[code://packages/server/src/commands/plugin.ts#L177-L212](../../../../packages/server/src/commands/plugin.ts#L177-L212) - `plugin.update`, `oneAtATime` and `deploymentTokenOnly`"
---

## Objective

`ahpd update` and `POST /api/update` exist, answer `--check`, and refuse every case that would leave a daemon that cannot restart.

## Files

- `CREATE: packages/server/src/commands/update.ts` - `declareUpdate`, the command `daemon.update`.
- `UPDATE: packages/server/src/selfupdate.ts` - `planUpdate()`, which reads the target version and returns the refusal or the plan.
- `UPDATE: packages/server/src/commands/registry.ts:56-76` - `declareUpdate(registry)` in `cliRegistry` and in the served registry.
- `CREATE: packages/server/test/server-update.test.ts` - the check and refusal cases, against a local registry.

## Steps

1. Write the tests first, with a fake registry and a fake record.
2. Declare `daemon.update` with the CLI pattern `update`, and `POST /update` over HTTP.
3. Give it the inputs `version`, `check` and `force`, the scope `config:write` and the effect `change`.
4. Set `meta: { deploymentTokenOnly: 'update the daemon' }`.
5. Run the body in `oneAtATime`.
6. Read the target from `version`, or from the npm latest of `@ahpd/server` through `registry()`.
7. Refuse a target that `newer` does not put after the running version.
8. Refuse a daemon that `notRestartable` refuses, with the same words.
9. Refuse a running turn with `busy`, unless `force`.
10. Refuse an install place that `installPlace` refuses.
11. Answer `--check` with `{current, latest, may: true}`, or with `may: false` and `why`.
12. Set this task and the plan row to `implemented`.

## Validation

- A test: `--check` answers the current and the latest version.
- A test: the update refuses an older or an equal `--version`.
- A test: the update refuses a daemon in the foreground with `FOREGROUND`.
- A test: the update refuses a running turn and names the session. `--force` passes that check.
- A test: `POST /api/update` with a person's token answers 403.
- `pnpm -s build`, `pnpm -s typecheck`, `node tools/schema.mjs` and the server vitest suite pass.

## Resume

Done 2026-10-19. Every step is built, and every case the Validation names passes. Not reviewed.

`declareUpdate` is `daemon.update`, with the CLI pattern `update`, `POST /update`, the inputs `version`, `check` and `force`, `config:write`, the effect `change`, and `deploymentTokenOnly: 'update the daemon'`.
The body runs in `oneAtATime`.

`planUpdate` in `selfupdate.ts` answers `{current, latest, place}` or `{current, latest, why}`.
It asks npm's `dist-tags` for the latest when no version is named. A target `newer` does not put after the running version is refused. Then it reuses `notRestartable` and `busy` from `restart.ts`, and last reads `installPlace`.
`--check` answers `{current, latest, may: true}`, or `{current, latest, may: false, why}`.

Departures:
- `restart.ts` exports `FOREGROUND`, `busy` and `notRestartable`, which were private, so the update gives the same words.
- `served.ts` registers the command beside `registry.ts`, because the served registry is built there.
- `declareUpdate` takes an optional `UpdateFacts`, as `declarePlugin` takes `ServedFacts`, so a case can hand it a record, the turns, the registry and the install place.
- A terminal cannot see running turns, so it passes none; the daemon refuses a turn when the restart is signalled (task 03).
- The non-check path answers the plan for now. Task 03 replaces it with the install, the plugin move and the restart.

The nine cases in `server-update.test.ts` pass against a local registry server. The server suite passes, 1206 tests in 59 files, and build, typecheck and the schema are clean.
