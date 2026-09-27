---
title: The update check is declared by what it turns on, and its test can fail
status: todo
depends: [task-12-cofold-fields-say-whether-they-negate.md, task-17-cofold-leaves-an-untyped-flag-out.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L200-L204](../../../../packages/server/src/commands/options.ts#L200-L204) - `updateCheck` spelled `--no-update-check`, `true` meaning off"
  - "[code://packages/server/src/commands/options.ts#L386](../../../../packages/server/src/commands/options.ts#L386) - the fold"
  - "[code://packages/server/src/update.ts#L124-L125](../../../../packages/server/src/update.ts#L124-L125) - `checkingUpdates`, off whenever `CI` or `NO_UPDATE_NOTIFIER` is set"
  - "[code://packages/server/test/server-cli.test.ts#L94-L133](../../../../packages/server/test/server-cli.test.ts#L94-L133) - `daemonEnv`, which sets `CI: '1'`, and `cli()`, which runs every case in it"
  - "[code://packages/server/test/server-cli.test.ts#L472-L482](../../../../packages/server/test/server-cli.test.ts#L472-L482) - the update-check case, which passes whatever the flag does"
---

## Objective

`updateCheck` is `true` when the check runs, on every surface, and the pinning test proves `--no-update-check` and `"updateCheck": false` each silence the update line.

## Files

- `UPDATE: packages/server/src/commands/options.ts:68-69` - the `Options.updateCheck` comment, which stays "Ask npm, in the background, whether a newer version exists".
- `UPDATE: packages/server/src/commands/options.ts:200-204` - the field, declared positively.
- `UPDATE: packages/server/src/commands/options.ts:386` - the fold.
- `UPDATE: packages/server/test/server-cli.test.ts:94-133` - `cli()` can run a case without `CI`.
- `UPDATE: packages/server/test/server-cli.test.ts:472-482` - the update-check case, run without `CI`.
- `UPDATE: packages/server/test/server-commands.test.ts:34-41` - `DAEMON_FLAGS` still names `--no-update-check`.

## Steps

1. Apply decision [a-daemon-flag-is-declared-by-what-it-turns-on](../../../decisions/a-daemon-flag-is-declared-by-what-it-turns-on.md): the field `updateCheck` is a boolean whose `true` means the check runs, with a description that says it is on by default and that `--no-update-check`, `NO_UPDATE_NOTIFIER`, `CI` and `"updateCheck": false` turn it off.
2. The spelling: the field is spelled `--update-check` with `cli: { negatable: true }`, so `--no-update-check` sets it to `false` and `--update-check` to `true`. This needs the cofold release from task 12, and the fold in step 3 needs the one from task 17, which Softov publishes; do not start until ahpd depends on it.
3. Keep the field without a schema `default`, as the header of `options.ts` requires, so a flag is told apart from the file; in `optionsFrom` the fold becomes, per decision [an-untyped-flag-stays-absent-in-cofold-input](../../../decisions/an-untyped-flag-stays-absent-in-cofold-input.md): the input's boolean when one was typed (after task 17 an untyped flag is absent, not `false`), else `false` when the file says `"updateCheck": false`, else `true`.
4. Give `cli()` in `packages/server/test/server-cli.test.ts` a way to run a case with `CI` and `NO_UPDATE_NOTIFIER` both removed from the environment (for example an `unset` list), leaving every other case as it is.

## Validation

- `packages/server/test/server-cli.test.ts`, the update-check case rewritten to run without `CI`: with a live `daemon.json` and an `update.json` naming `9.9.9`, `['status']` prints the `update:` line (three lines of stdout), `['status', '--no-update-check']` does not, and `['status']` with `{ "updateCheck": false }` in the file does not.
- The same case without the `CI` removal is the fake that made it pass before: the removal is what makes the first assertion possible, and the first assertion is what fails if the update line can never print.
- `packages/server/test/server-commands.test.ts`, a new case importing `optionsFrom`: `optionsFrom({ updateCheck: false }).updateCheck` is `false`, `optionsFrom({ updateCheck: true }).updateCheck` is `true`, and `optionsFrom({}).updateCheck` is `true` with an empty configuration; today the first two are inverted, so the case fails.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts packages/server/test/server-commands.test.ts` green.

## Resume

Stopped. The task's fold cannot be built on `@cofold/commands` 0.2.1, so the code is back to what it was and the suite is green.

`canonicalFromCli` and `canonicalFromObject` both write `false` into the canonical input for a boolean flag that was not typed (input.js, the `input[name] = false` branch). With the positive `--update-check` spelling step 2 asks for, `--no-update-check` (which tokenizes to `{"--update-check": false}`) and no flag at all both arrive at `optionsFrom` as `updateCheck: false`, and nothing in the input says which happened. No fold can then keep the default on for an absent flag and off for `--no-update-check`.

The one approach that does work is a schema `default: true` on the field, with the fold `input.updateCheck === false ? false : file.updateCheck !== false`: absent and `--update-check` both mean on, `--no-update-check` means off, and `"updateCheck": false` in the file means off. Step 3 forbids exactly that default, so I did not choose it.

Question for you: which way do you want this?
1. Put `default: true` on the field and use that fold, accepting that `--update-check` cannot beat `"updateCheck": false` in the file (the file wins for the one combination the validation does not test).
2. Get a cofold release where an absent flag stays `undefined` in the canonical input, and then use the fold as step 3 writes it.
3. Something else you have in mind.

Tried and reverted: the `--update-check` plus `negatable: true` declaration, the input-first fold, the `unset` list in `cli()`, the rewritten update case, the `optionsFrom` case and `DAEMON_FLAGS` renaming. The failing assertion was `['status']` printing no `update:` line, because the default had become off.

Decided 2026-09-26: Softov chose option 2, recorded in [an-untyped-flag-stays-absent-in-cofold-input](../../../decisions/an-untyped-flag-stays-absent-in-cofold-input.md). Task 17 makes the cofold change and takes the release; this task starts again after it, from the steps above.
