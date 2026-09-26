---
title: plugin install and remove say each line as it happens, and npm writes to stderr
status: todo
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L48-L78](../../../../packages/server/src/commands/plugin.ts#L48-L78) - `say` buffers into `said`, and `refuse` exits before the buffer is written"
  - "[code://packages/server/src/install.ts#L45-L46](../../../../packages/server/src/install.ts#L45-L46) - `run` spawns npm with `stdio: 'inherit'`, so npm writes to stdout"
  - "[code://packages/server/src/install.ts#L260-L274](../../../../packages/server/src/install.ts#L260-L274) - `removePlugins` edits the configuration, says so, then runs npm"
---

## Objective

A `plugin remove` whose npm step fails still shows `plugins -= <name> in <file>` before the error, and `plugin install --json` writes nothing to stdout but its JSON.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts:48-78` - `say` writes each line when it is said.
- `UPDATE: packages/server/src/install.ts:45-46` - npm's stdout goes to this process's stderr.
- `UPDATE: test/server-cli.test.ts` - two cases with a fake `npm` on `PATH`.

## Steps

1. In `declarePlugin`'s `write`, make `say` write the line at once: to stdout through `context.write` in prose mode, and to stderr through `context.error` when `--json` or `--quiet` is set, so stdout stays the payload.
2. The returned `output(...)` then carries the JSON only, with an empty prose text, since each line was already written.
3. In `install.ts`'s `run`, spawn npm with stdin inherited and both stdout and stderr on this process's stderr, keeping `done.stderr` as the reason `installPlugins` and `removePlugins` throw with (capture it, or pass `stdio: ['inherit', 2, 'pipe']` and forward what is captured to stderr).
4. This is the plan's settled row "npm's output goes to stderr".

## Validation

- A fake `npm` script in `test/fixtures/` that prints `npm noise` to stdout and exits with the code a variable names; each case puts its directory first on `PATH`.
- Case "remove says the configuration changed before npm fails": the file names `some-plugin`, fake npm exits 1; `['plugin', 'remove', 'some-plugin', '--config-file', config]` exits 2, its stdout contains `plugins -= some-plugin`, and the file no longer names it. Today stdout is empty.
- Case "install --json writes only JSON": fake npm exits 0; `['plugin', 'install', 'some-plugin', '--no-enable', '--json', '--config-file', config]` exits 0 and `JSON.parse(stdout)` succeeds, with `npm noise` on stderr. Today stdout starts with `npm noise` and the parse fails.
- `node_modules/.bin/vitest run test/server-cli.test.ts` green.

## Resume
