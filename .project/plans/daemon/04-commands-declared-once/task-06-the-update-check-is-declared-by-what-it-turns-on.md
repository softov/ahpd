---
title: The update check is declared by what it turns on, and its test can fail
status: todo
depends: [task-12-cofold-fields-say-whether-they-negate.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L189-L193](../../../../packages/server/src/commands/options.ts#L189-L193) - `updateCheck` spelled `--no-update-check`, `true` meaning off"
  - "[code://packages/server/src/commands/options.ts#L346](../../../../packages/server/src/commands/options.ts#L346) - the fold"
  - "[code://packages/server/src/update.ts#L124-L125](../../../../packages/server/src/update.ts#L124-L125) - `checkingUpdates`, off whenever `CI` or `NO_UPDATE_NOTIFIER` is set"
  - "[code://test/server-cli.test.ts#L53-L57](../../../../test/server-cli.test.ts#L53-L57) - `cli()`, which sets `CI: '1'` on every case"
  - "[code://test/server-cli.test.ts#L225-L235](../../../../test/server-cli.test.ts#L225-L235) - the update-check case, which passes whatever the flag does"
---

## Objective

`updateCheck` is `true` when the check runs, on every surface, and the pinning test proves `--no-update-check` and `"updateCheck": false` each silence the update line.

## Files

- `UPDATE: packages/server/src/commands/options.ts:69-70` - the `Options.updateCheck` comment, which stays "Ask npm, in the background, whether a newer version exists".
- `UPDATE: packages/server/src/commands/options.ts:189-193` - the field, declared positively.
- `UPDATE: packages/server/src/commands/options.ts:346` - the fold.
- `UPDATE: test/server-cli.test.ts:53-76` - `cli()` can run a case without `CI`.
- `UPDATE: test/server-cli.test.ts:225-235` - the update-check case, run without `CI`.
- `UPDATE: test/server-commands.test.ts:17-23` - `DAEMON_FLAGS` still names `--no-update-check`.

## Steps

1. Apply decision [a-daemon-flag-is-declared-by-what-it-turns-on](../../../decisions/a-daemon-flag-is-declared-by-what-it-turns-on.md): the field `updateCheck` is a boolean whose `true` means the check runs, with a description that says it is on by default and that `--no-update-check`, `NO_UPDATE_NOTIFIER`, `CI` and `"updateCheck": false` turn it off.
2. The spelling, per decision [a-cofold-field-says-whether-its-flag-negates](../../../decisions/a-cofold-field-says-whether-its-flag-negates.md): the field is spelled `--update-check` with `cli: { negatable: true }`, so `--no-update-check` sets it to `false` and `--update-check` to `true`. This needs the cofold release from task 12, which Softov publishes; do not start until ahpd depends on it.
3. Keep the field without a schema `default`, as the header of `options.ts` requires, so a flag is told apart from the file; in `optionsFrom` the fold becomes: the input's boolean when one was typed, else `false` when the file says `"updateCheck": false`, else `true`.
4. Give `cli()` in `test/server-cli.test.ts` a way to run a case with `CI` and `NO_UPDATE_NOTIFIER` both removed from the environment (for example an `unset` list), leaving every other case as it is.

## Validation

- `test/server-cli.test.ts`, the update-check case rewritten to run without `CI`: with a live `daemon.json` and an `update.json` naming `9.9.9`, `['status']` prints the `update:` line (three lines of stdout), `['status', '--no-update-check']` does not, and `['status']` with `{ "updateCheck": false }` in the file does not.
- The same case without the `CI` removal is the fake that made it pass before: the removal is what makes the first assertion possible, and the first assertion is what fails if the update line can never print.
- `test/server-commands.test.ts`, a new case importing `optionsFrom`: `optionsFrom({ updateCheck: false }).updateCheck` is `false`, `optionsFrom({ updateCheck: true }).updateCheck` is `true`, and `optionsFrom({}).updateCheck` is `true` with an empty configuration; today the first two are inverted, so the case fails.
- `node_modules/.bin/vitest run test/server-cli.test.ts test/server-commands.test.ts` green.

## Resume
