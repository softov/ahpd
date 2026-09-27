---
title: start forwards the words after start, wherever it appears
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/start.ts#L98-L105](../../../../packages/server/src/commands/start.ts#L98-L105) - the program's option table, and the words after the `start` word it finds"
  - "[code://packages/server/src/commands/start.ts#L22-L36](../../../../packages/server/src/commands/start.ts#L22-L36) - `wordAt`, which reads a candidate `start` as a word only when nothing before it is one"
  - "[code://packages/server/src/commands/options.ts#L93-L108](../../../../packages/server/src/commands/options.ts#L93-L108) - `programGlobals`, the program's own options the table has to know"
  - "[code://packages/server/src/daemon.ts#L118-L148](../../../../packages/server/src/daemon.ts#L118-L148) - `start`, which spawns this program again with the words it is given"
  - "[code://packages/server/test/server-cli.test.ts#L386-L403](../../../../packages/server/test/server-cli.test.ts#L386-L403) and [#L94-L110](../../../../packages/server/test/server-cli.test.ts#L94-L110) - the case, and the `daemonEnv` loader a detached child inherits"
---

## Objective

`ahpd <globals> start <flags>` detaches a daemon started with exactly the words after `start`, and the record, `ahpd status` and `ahpd stop` name the process that is actually serving.

## Files

- `UPDATE: packages/server/src/commands/start.ts:98-105` - `rest` is the slice of `process.argv` after the word `start`, found with the same grammar the program parses with, rather than everything after the first word.
- `UPDATE: packages/server/src/commands/options.ts:93-108` - `programGlobals`, the program's own options, declared where `start` can build the table from them.
- `UPDATE: packages/server/src/main.ts:139` - the program takes its globals from that declaration rather than from an inline list.
- `UPDATE: packages/server/test/server-cli.test.ts` - a `start` group that detaches, reads the record and stops.

## Steps

1. In `declareStart`'s `run`, find the index of the `start` command word in `process.argv.slice(2)` with `@cofold/commands`' `tokenize` over the program's option table (the one `main.ts:152-154` builds), so a flag value that happens to be the string `start` is never taken for the word.
2. Forward only the words after it to `start()` in `daemon.ts`; globals typed before `start` (`--json`, `--no-color`, `-q`, `--verbose`, `--remote`, `--token`) are not forwarded.
3. This is the plan's settled row "`start` forwards the words after `start` wherever it appears"; it is a fix, not a fork.

## Validation

- `packages/server/test/server-cli.test.ts`, new case "a global before start still starts the daemon the record names": run `['--no-color', 'start', '--port', '0', '--plugin', BACKEND, '--automations', 'memory', '--sessions', 'memory', '--no-update-check']`, then `['status']` exits 0 and names the pid in `daemon.json`, then `['stop']` exits 0 and no process for that pid is left.
- Today this fails: the child is spawned with `start --port 0 ...`, detaches a grandchild, and exits; `status` answers "None running." with exit 1 and the grandchild is orphaned (seen by hand on 2026-09-26).
- The case kills any pid it started in `afterEach`, so a failure does not leave a daemon running.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Done.
`start` finds its own word with the program's option table and forwards only what follows it, and `programGlobals` is declared once for both the program and that table.
The test's detached child is a TypeScript process too, so `cli` carries the development loader on `NODE_OPTIONS`: a daemon spawned by `start` inherits the environment, not this process's argv.
`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green, 32 cases.
