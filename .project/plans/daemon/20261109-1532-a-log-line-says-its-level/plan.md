---
title: A log line says its level
domain: daemon
status: planned
priority: medium
created: 2026-11-09
revalidated: 2026-11-09
refs:
  - "[code://packages/sdk/src/host/telemetry.ts#L103-L166](../../../../packages/sdk/src/host/telemetry.ts#L103-L166) - the host's one `log`: it calls `onEvent`, raises the `log` event, and sends every line to OTLP as INFO"
  - "[code://packages/sdk/src/host/context.ts#L569](../../../../packages/sdk/src/host/context.ts#L569) - `HostContext.log`, a bare `(message: string) => void`"
  - "[code://packages/sdk/src/types/host.ts#L1096-L1097](../../../../packages/sdk/src/types/host.ts#L1096-L1097) - `HostOptions.onEvent`, the embedder's one-line writer"
  - "[code://packages/sdk/src/types/events.ts#L372-L376](../../../../packages/sdk/src/types/events.ts#L372-L376) - `LogEvent`, the line a plugin reads, with no level"
  - "[code://packages/sdk/src/types/plugin.ts#L752](../../../../packages/sdk/src/types/plugin.ts#L752) - `PluginHost.log`, a plugin's one line to the daemon's log"
  - "[code://packages/server/src/commands/run.ts#L335](../../../../packages/server/src/commands/run.ts#L335) - `stamp`, the daemon's writer: an ISO time and the line, on stderr"
  - "[code://packages/server/src/commands/options.ts#L913](../../../../packages/server/src/commands/options.ts#L913) - the daemon's options, where each key is also a flag; `wire` is the sibling a new key copies"
  - "[code://docs/server/RUN.md#L23-L30](../../../../docs/server/RUN.md#L23-L30) - where the docs say what `daemon.log` holds"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/log/common/log.ts#L909-L918 - VS Code's level names: trace, debug, info, warn, error, off
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/log/node/spdlogLog.ts#L29 - VS Code's log file line, `%Y-%m-%d %H:%M:%S.%e [%l] %v`, in local time
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/otlp/otlpLogEmitter.ts#L38-L75 - VS Code's OTLP severity for each level, and the band a subscription reads
  - https://nodejs.org/docs/latest-v22.x/api/util.html#utilstyletextformat-text-options - `util.styleText`, which colours text only where the stream and `NO_COLOR`/`FORCE_COLOR` allow
---

## Goal

Each line the daemon logs has a level: trace, debug, info, warn or error, as VS Code's log service has.
A person reads the level on each line, in colour on a terminal, and chooses how much the daemon writes with `--log-level`.
OTLP subscribers and plugins get every line with its level, so `ahp-otlp://logs/warn` carries only warnings and errors, as VS Code's host sends them.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "log\(" packages/*/src` - 58 files and about 320 calls write a log line, each a bare string.
- `rg -i "severity" packages/sdk/src` - every OTLP record is `severityNumber: 9`, `INFO`.
- `rg "onProblem|warn: \(message\)" packages/server/src` - several writers go to `process.stderr` directly, without `stamp`.
- `rg -i "log ?level|verbose" .project docs` - no plan, decision or option for levels exists.

### Runtime path

```
a call site -> ctx.log.<level>(line) -> telemetry log(line, level)
  -> onEvent(line, level) -> the daemon's writer: drop below logLevel, then time, [level], line on stderr (daemon.log when detached)
  -> raise { type: 'log', line, level } -> plugins
  -> OTLP record at the level's severity -> each ahp-otlp://logs/{level} subscription whose band holds it
```

### Gaps

- No level exists anywhere on the path, so a refusal and a routine line read the same.
- The OTLP level template filters nothing, because every record is INFO.
- Not found: a setting for how much the daemon writes - searched `logLevel`, `verbose`, `quiet` in `packages/server/src`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A level is one of VS Code's: trace, debug, info, warn, error | "ok acceptable" to the proposal of VS Code's levels, 2026-11-09 | 01 |
| Code says a level with methods, as VS Code's `ILogService`: `log.trace`, `log.debug`, `log.info`, `log.warn`, `log.error`; a plain `log(line)` stays info | "Methods, as VS Code's ILogService", 2026-11-09 | 01 |
| A plugin's `host.log` gets the same methods, and the `log` event gets `level` | (defaulted: the same shape as the host's, and added fields break no plugin) | 01 |
| An OTLP record carries the line's level at VS Code's severity number: 1, 5, 9, 13, 17 | (defaulted: VS Code's `logLevelToOtlpSeverity`) | 01 |
| Every existing log line is read and given its level in this plan | "Every line, one by one", 2026-11-09 | 03 |
| The setting is `logLevel`, the flag `--log-level`, values trace, debug, info, warn, error, off, default info | "--log-level so future we can have like --log-file and more log config", 2026-11-09 | 02 |
| `logLevel` filters only stderr and the log file; OTLP and plugins get every line | "Only stderr and the file", 2026-11-09 | 02 |
| A line reads as VS Code's: `2026-11-09 14:02:11.123 [warning] message` | "ok acceptable" to VS Code's line format, 2026-11-09 | 02 |
| The time is a setting, `logTime`, `local` or `utc`, default local | "config. defaults to local.", 2026-11-09 | 02 |
| Colour only where `util.styleText` allows it: the tag of each level, and an error's whole line; error red, warning yellow, debug and trace grey, info plain | "ok acceptable" to colour on a terminal only, 2026-11-09; colours (defaulted: the usual meanings) | 02 |
| The startup lines on stdout keep their shape | (defaulted: `ahpd status` and `skippedOf` parse them) | 02 |

## Proposed architecture

- **Data flow** - A call site picks a level with a method. `telemetry.log` takes the level beside the line and hands both to `onEvent`, to the `log` event and to OTLP.
- **Event flow** - `LogEvent` gains `level`. The OTLP fan-out already reads the subscription's band; it now compares against the record's own severity.
- **State flow** - None. `logLevel` and `logTime` are read once when the daemon starts its writer.
- **Layer responsibilities**:
  - sdk: the `Logger`, and the level on the event and on OTLP.
  - server: the line, the colour, the options and the docs.
  - Each package: the level of its own lines.
- **Source-of-truth files** - [`code://packages/sdk/src/host/telemetry.ts`](../../../../packages/sdk/src/host/telemetry.ts) for where a line goes; [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) for how it is written.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host's log takes a level](task-01-the-hosts-log-takes-a-level.md) | todo | - |
| [02 - The daemon writes the level](task-02-the-daemon-writes-the-level.md) | todo | 01 |
| [03 - Every line has its level](task-03-every-line-has-its-level.md) | todo | 01 |

## Risks and tradeoffs

- An embedder or a backend passes a plain `(line) => void` as its log - `loggerOf` wraps it, so the methods always exist.
- The ~320 calls make a long diff - task 03 changes only the method of each call, never its words.
- A log reader can match the old ISO time - none was found here, and `logTime: utc` keeps a zone on each line.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-hosts-log-takes-a-level.md](task-01-the-hosts-log-takes-a-level.md).
- **Open questions:** none.
- **Watch out for:** callers outside this repository pass a backend's `log` option as a plain function. Wrap it with `loggerOf`, and keep the option's type.

## Final verification checklist

- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm i18n`, `pnpm test:unit` and `pnpm test:processes` pass.
- [ ] `ahpd` in a terminal shows `[warning]` in yellow and `[error]` in red, and `NO_COLOR=1 ahpd` shows no colour.
- [ ] `daemon.log` of a detached daemon has no escape codes.
- [ ] `--log-level warn` writes only warnings and errors; a client on `ahp-otlp://logs/debug` still gets debug lines.
- [ ] `logTime: utc` writes the time in UTC.
