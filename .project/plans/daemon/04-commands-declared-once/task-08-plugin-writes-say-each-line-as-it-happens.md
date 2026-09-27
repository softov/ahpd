---
title: plugin install and remove say each line as it happens, and npm writes to stderr
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L61-L70](../../../../packages/server/src/commands/plugin.ts#L61-L70) and [#L95](../../../../packages/server/src/commands/plugin.ts#L95) - `say` writes each line when it is said, and the result carries no prose"
  - "[code://packages/server/src/install.ts#L49-L68](../../../../packages/server/src/install.ts#L49-L68) - `run` puts npm's stdout on this process's stderr and keeps its stderr as the reason"
  - "[code://packages/server/src/install.ts#L272-L293](../../../../packages/server/src/install.ts#L272-L293) - `removePlugins` edits the configuration, says so, then runs npm"
  - "[code://packages/server/test/fixtures/npm-fake/npm](../../../../packages/server/test/fixtures/npm-fake/npm) - the stand-in npm the two cases put first on `PATH`"
  - "[code://packages/server/test/server-cli.test.ts#L587-L604](../../../../packages/server/test/server-cli.test.ts#L587-L604) - the two cases"
---

## Objective

A `plugin remove` whose npm step fails still shows `plugins -= <name> in <file>` before the error, and `plugin install --json` writes nothing to stdout but its JSON.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts:61-70, 95` - `say` writes each line when it is said.
- `UPDATE: packages/server/src/install.ts:49-68` - npm's stdout goes to this process's stderr.
- `CREATE: packages/server/test/fixtures/npm-fake/npm` - the stand-in npm.
- `UPDATE: packages/server/test/server-cli.test.ts:587-604` - two cases with a fake `npm` on `PATH`.

## Steps

1. In `declarePlugin`'s `write`, make `say` write the line at once: to stdout through `context.write` in prose mode, and to stderr through `context.error` when `--json` or `--quiet` is set, so stdout stays the payload.
2. The returned `output(...)` then carries the JSON only, with an empty prose text, since each line was already written.
3. In `install.ts`'s `run`, spawn npm with stdin inherited and both stdout and stderr on this process's stderr, keeping `done.stderr` as the reason `installPlugins` and `removePlugins` throw with (capture it, or pass `stdio: ['inherit', 2, 'pipe']` and forward what is captured to stderr).
4. This is the plan's settled row "npm's output goes to stderr".

## Validation

- A fake `npm` script in `packages/server/test/fixtures/` that prints `npm noise` to stdout and exits with the code a variable names; each case puts its directory first on `PATH`.
- Case "remove says the configuration changed before npm fails": the file names `some-plugin`, fake npm exits 1; `['plugin', 'remove', 'some-plugin', '--config-file', config]` exits 2, its stdout contains `plugins -= some-plugin`, and the file no longer names it. Today stdout is empty.
- Case "install --json writes only JSON": fake npm exits 0; `['plugin', 'install', 'some-plugin', '--no-enable', '--json', '--config-file', config]` exits 0 and `JSON.parse(stdout)` succeeds, with `npm noise` on stderr. Today stdout starts with `npm noise` and the parse fails.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Done.
`say` writes each line as it is said: stdout in prose mode, stderr when `--json` or `--quiet` asked for a payload, and the result carries no prose.
`install.ts`'s `run` gives npm this process's stdin and this process's stderr as its stdout, and keeps the captured stderr as the reason the caller throws with.
`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green, 37 cases.
