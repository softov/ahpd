---
title: A restart checks its line with the code that will run it
status: done
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

Built 2026-10-06.

- The case is in `packages/server/test/server-cli.test.ts`, `refuses a restart whose recorded line this code does not take, and the daemon runs on`. It failed first, on the code standing before this task, which for this case is the code of `c4e4dd0`: no turn is running, so nothing task 05 added to the restart path is reached. A daemon started on the echo backend, `--frobnicate` appended by hand to the record's `argv`, and `ahpd restart` answered `ahpd: Could not restart it: it exited with 2. See .../daemon.log` - the old daemon was down and the successor had died on the flag, so the machine was left with no daemon. After the fix the same command answers `ahpd: Its line cannot run now, so it was not stopped: Unknown option --frobnicate.` on one line, and the daemon is still the record's pid with its socket still open.
- The check mode is on the entry, `main.ts`, and is reached by `AHPD_CHECK_LINE=1` rather than by a word: the recorded line was written by another ahpd, so a flag meaning "check only" would be a flag no ahpd declares sitting in the one line that is read strictly. It calls `optionsOfLine(argv0, true)` and exits 0, or writes the words on stderr and exits `exitCodeFor`. `optionsOfLine` gained the `strict` flag, which is `permissive: false` to `tokenize` - the same two steps a run does, so a flag this ahpd has dropped, a flag given a value it does not take and a `config.json` that no longer parses all fail here.
- `restart.ts` gained `CHECK_LINE_ENV` and `successorTakes(argv)`: it spawns `process.execPath` with `[...process.execArgv, process.argv[1], ...argv]`, the variable set, the environment and the working directory inherited - the shape `daemon.ts`'s `start` uses, so what is checked is what a successor would be handed. It rejects with the first line of what the child said, and with a sentence of its own when the child said nothing - that it exited with a code, or that it did not answer in time: one line, because the daemon's refusal is one line of a log a terminal reads the rest of. The child's streams are pipes held by the parent, so a check never writes to `daemon.log`.
- The check is part of the line's read in `run.ts`, not a fifth parameter of `checkedRestart`: that read is already documented as the thing whose throw refuses the restart with `Its line cannot run now, so it was not stopped:`. It runs after the token is read, so a line this ahpd cannot read is refused in this ahpd's words (the case that writes half a `config.json`) rather than in a child's. The refusal is a refusal, so task 05's hold on new turns is let go and the daemon carries on.
- Seen while building: the check costs a node start on every restart, which the plan's risks already name, and it is spawned even for a restart that is refused afterwards for a running turn, since the read comes first. Left as it is: refusing earlier would mean checking the turns before the take is held, which is what task 05 decided against.
- And closed while building: a child that never answers would leave the read unreturned, which is a daemon that has stopped taking turns and never starts again. `successorTakes` therefore kills one that has said nothing in `CHECK_WAIT_MS` (ten seconds, against the twenty a whole successor gets) and refuses the restart with that. The case that would need the bound is a downgrade - an entry older than the variable, which serves the line instead of reading it - and there is no seam to stage one through, so the bound has no case of its own.
- `docs/DAEMON.md`: the check, in one sentence of what it costs, and that a successor inherits the old daemon's environment and working directory, so a changed variable or directory needs `ahpd stop` and `ahpd start`.
- Validation: the case above fails before the fix and passes after; `pnpm exec vitest run packages/server/test/server-cli.test.ts packages/server/test/server-restart.test.ts` passes, 116 tests; `pnpm typecheck` and `pnpm boundary` pass.
