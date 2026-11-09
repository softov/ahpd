---
title: The daemon writes the level
status: done
depends: [task-01-the-hosts-log-takes-a-level.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L335](../../../../packages/server/src/commands/run.ts#L335) - `stamp`, which becomes the writer of a level"
  - "[code://packages/server/src/commands/options.ts#L913](../../../../packages/server/src/commands/options.ts#L913) - the options, where `logLevel` and `logTime` go beside `wire`"
  - "[code://docs/server/RUN.md#L23-L30](../../../../docs/server/RUN.md#L23-L30) - the docs on `daemon.log`"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/log/node/spdlogLog.ts#L29 - the line format
  - https://nodejs.org/docs/latest-v22.x/api/util.html#utilstyletextformat-text-options - the colour
---

## Objective

The daemon writes each line as `2026-11-09 14:02:11.123 [warning] message`, in colour where the terminal allows it.
`--log-level` chooses the lowest level it writes, and `--log-time` chooses local time or UTC.

## Files

- `CREATE: packages/server/src/logline.ts` - `logLine(line, level, { time, colour })`: the time, the tag in spdlog's words (trace, debug, info, warning, error), the line, and the colour.
- `UPDATE: packages/server/src/commands/run.ts:335` - `stamp(line, level)` drops a line below `logLevel` and writes `logLine` to stderr.
- `UPDATE: packages/server/src/commands/options.ts:913` - `logLevel` (trace, debug, info, warn, error, off; default info) and `logTime` (local, utc; default local).
- `UPDATE: packages/server/src/commands/run.ts` - the writers that go to `process.stderr` directly go through `stamp` with their level.
- `UPDATE: docs/server/RUN.md:23-30` - what a line holds, its level and its colour, and the two settings.
- `CREATE: packages/server/test/logline.test.ts` - the cases in *Validation*.

## Steps

1. Write `logLine` with the time as `YYYY-MM-DD HH:MM:SS.mmm`, local or UTC; a UTC time ends in `Z`.
2. Colour with `util.styleText` against `process.stderr`: the tag red, yellow or grey; an error's whole line red; info plain.
3. Add `logLevel` and `logTime` to the options; their flags are `--log-level` and `--log-time`.
4. Make `stamp` take the level, drop a line below `logLevel`, and write nothing at `off`.
5. Send each log line that `run.ts` writes to `process.stderr` through `stamp`.
6. Keep the stdout announcement as it is.
7. Write the docs in `RUN.md`. The options generate the option reference.

## Validation

- `packages/server/test/logline.test.ts` has these cases:
  - The local time, and the UTC time.
  - The tag of each level.
  - No escape codes when the stream is not a terminal.
  - Colour with `FORCE_COLOR=1`, and none with `NO_COLOR=1`.
- A daemon case: `--log-level warn` writes a warn line and not an info line.
- By hand: `ahpd` in a terminal shows `[warning]` in yellow; `daemon.log` of a detached daemon has no escape codes.

## Resume

Built on 2026-11-09 and merged in PR #259. The store problems that `run.ts` wrote to stderr without a time now go through `stamp` at warn. The examples in `RUN.md` get real lines in task 03.

