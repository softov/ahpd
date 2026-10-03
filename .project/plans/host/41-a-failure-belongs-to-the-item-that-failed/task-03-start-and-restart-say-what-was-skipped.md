---
title: Start and restart say what was skipped
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L607-L623](../../../../packages/server/src/commands/run.ts#L607-L623) - where load problems are stamped"
  - "[code://packages/server/src/commands/restart.ts#L61-L63](../../../../packages/server/src/commands/restart.ts#L61-L63) - the lines the restarting terminal reads"
  - "[code://packages/server/src/commands/start.ts](../../../../packages/server/src/commands/start.ts) - the detached start's wait for ready"
---

## Objective

A detached `ahpd start` and an `ahpd restart` print every load problem, and every preset a plugin skipped, before their success line, and exit 0 while any agent loaded.

## Files

- `UPDATE: packages/server/src/commands/run.ts` - load problems are carried to whatever the starting command reads for readiness, beside being stamped.
- `UPDATE: packages/sdk/src/types/plugin.ts` and `packages/server/src/plugins.ts` - a plugin's skipped item reaches the same list: `PluginHost` gains `problem(line)`, collected with the loader's problems; claude/16's skip line uses it once both land.
- `UPDATE: packages/server/src/commands/start.ts` and `restart.ts` - print the lines before the success line.
- `UPDATE: packages/server/test/` (start and restart tests) - the cases below.

## Steps

1. Read how the detached start and the restart learn the successor is ready, and carry the problems on that same channel; no new file or socket.
2. Add `problem(line)` to `PluginHost`; a plugin's problem does not skip it.
3. Print each line as `skipped: <line>`; exit code unchanged.

## Validation

- A start with one plugin that throws in `apply` and one that loads prints `skipped: plugin <name> ...` before the started line and exits 0.
- A plugin calling `host.problem('presets.router ...')` has that line printed the same way.
- The restart prints the successor's lines between `STARTING` and the restarted line.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
