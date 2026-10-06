---
title: A restart checks its line with the code that will run it
status: todo
depends: [task-05-a-restart-takes-no-new-turn-once-checked.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L951-L955](../../../../packages/server/src/commands/run.ts#L951-L955) - `optionsOfLine`, this process's code, `permissive: true`"
  - "[code://packages/server/src/commands/restart.ts#L124-L131](../../../../packages/server/src/commands/restart.ts#L124-L131) - a successor that fails leaves no daemon"
  - "[code://docs/DAEMON.md#L199-L226](../../../../docs/DAEMON.md#L199-L226) - `ahpd restart`"
---

## Objective

Before the old daemon goes down, the binary the successor will run parses the recorded line and its config; a line it refuses (a flag the new code no longer knows, after `npm i -g` of a new ahpd) refuses the restart and leaves the old daemon running.
The docs say the successor keeps the old daemon's environment and working directory.

## Files

- `UPDATE: packages/server/src/commands/run.ts` - a check mode the successor binary runs: parse the line and the config strictly, exit 0 or print the refusal.
- `UPDATE: packages/server/src/commands/restart.ts` - run that check before `down`.
- `UPDATE: docs/DAEMON.md:199-226` - the check, and the environment sentence.
- `UPDATE: packages/server/test/server-cli.test.ts` - the case below.

## Steps

1. Failing case first: record a line with a flag the current code does not know (write it into `daemon.json` by hand in the test), restart; today the old daemon goes down and none comes back.
2. A check mode on the daemon's entry, reached by an environment variable rather than a flag so an older line cannot collide with it: parse the line strictly (`permissive: false`) and load the config, then exit.
3. `checkedRestart` spawns the recorded binary (`process.argv[1]`, the one the successor runs) in that mode with the recorded line, and refuses with its words when it exits non-zero.
4. `docs/DAEMON.md`: a restart checks the line first; the successor inherits the old daemon's environment and working directory, so a changed variable needs `ahpd stop` and `ahpd start`.

## Validation

- The case fails on `main` and passes after; a good line still restarts.
- `pnpm exec vitest run packages/server/test/server-cli.test.ts packages/server/test/server-restart.test.ts`.

## Resume
