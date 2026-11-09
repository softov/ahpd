---
title: A log line says its level - implemented
date: 2026-11-09
refs:
  - git://10ed70e69
  - "[code://packages/sdk/src/log.ts](../../../../packages/sdk/src/log.ts)"
  - "[code://packages/server/src/logline.ts](../../../../packages/server/src/logline.ts)"
---

Each line the daemon logs has a level. The daemon writes it as VS Code writes its logs, `2026-11-09 14:02:11.123 [warning] message`, in colour on a terminal.
`--log-level` chooses how much the daemon writes, and `--log-time` chooses local time or UTC.
OTLP subscribers and plugins get every line with its level, and an ACP server's own stderr line keeps the level it says.

## What was built

- [`code://packages/sdk/src/log.ts`](../../../../packages/sdk/src/log.ts) - `LogLevel`, `Logger`, `loggerOf`, `LOG_SEVERITY` and `levelIn`.
- [`code://packages/sdk/src/host/telemetry.ts`](../../../../packages/sdk/src/host/telemetry.ts) - the host's log takes the level to `onEvent`, the `log` event and OTLP.
- [`code://packages/server/src/logline.ts`](../../../../packages/server/src/logline.ts) - the line, its time and its colour.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `logLevel` and `logTime`.
- [`code://packages/agent-acp/src/connection.ts`](../../../../packages/agent-acp/src/connection.ts) - each stderr line of a server at the level it says.
- [`code://docs/server/RUN.md`](../../../../docs/server/RUN.md) - what a line holds, and the two settings.

## Verified

- `log-levels.test.ts`, 8 cases: the level on `onEvent`, the event and OTLP, and `levelIn` on each shape of line.
- `logline.test.ts`, 6 cases: the time, the tag, the colour, `NO_COLOR` and `logLevel`.
- `config-check.test.ts`: a daemon at `logLevel: warn` writes a warning line and no info line.
- CI passed every job on PR #259.

## Departures from the plan

- A module that takes a plain log callback passes the level as a second argument, as VS Code's `ILogger.log` takes one. The plan had each call use a method, and a plain callback has none.
- The store problems `run.ts` wrote to stderr without a time go through the same writer, at warn.
- The Windows update helper writes the same line shape, inline, because it imports nothing from the daemon.
- Task 04, a server's stderr line keeps its level, was added on 2026-11-09 at the user's request.

## Left for later

- A server line that says no level, such as gemini's, stays info.
