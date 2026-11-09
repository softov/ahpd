---
title: The host's log takes a level
status: doing
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/telemetry.ts#L103-L166](../../../../packages/sdk/src/host/telemetry.ts#L103-L166) - the one `log`, which gains the level"
  - "[code://packages/sdk/src/host/context.ts#L569](../../../../packages/sdk/src/host/context.ts#L569) - `HostContext.log`, which becomes a `Logger`"
  - "[code://packages/sdk/src/types/events.ts#L372-L376](../../../../packages/sdk/src/types/events.ts#L372-L376) - `LogEvent`, which gains `level`"
  - "[code://packages/sdk/src/types/plugin.ts#L752](../../../../packages/sdk/src/types/plugin.ts#L752) - `PluginHost.log`, which becomes a `Logger`"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/otlp/otlpLogEmitter.ts#L38-L75 - the severity number of each level
---

## Objective

The sdk has a `Logger`: a function that logs at info, with `trace`, `debug`, `info`, `warn` and `error` methods.
The host's `log`, a plugin's `host.log`, the `log` event and each OTLP record carry the line's level.

## Files

- `CREATE: packages/sdk/src/log.ts` - `LogLevel`, `Logger`, `loggerOf(write)` that makes a `Logger` of a `(line, level) => void`, and `LOG_SEVERITY`, VS Code's OTLP severity of each level.
- `UPDATE: packages/sdk/src/index.ts` - export `LogLevel`, `Logger` and `loggerOf`.
- `UPDATE: packages/sdk/src/host/telemetry.ts:103-166` - `log(message, level = 'info')`; `onEvent(message, level)`; the event carries `level`; the OTLP record carries the level's severity, and reaches a subscription when its severity is at or above the subscription's band.
- `UPDATE: packages/sdk/src/host/context.ts:569` - `log: Logger`.
- `UPDATE: packages/sdk/src/types/host.ts:1096-1097` - `onEvent?(message: string, level?: LogLevel): void`.
- `UPDATE: packages/sdk/src/types/events.ts:372-376` - `LogEvent.level: LogLevel`.
- `UPDATE: packages/sdk/src/types/plugin.ts:752` - `log: Logger`.
- `UPDATE: packages/sdk/src/host.ts` - build `ctx.log` with `loggerOf` over `telemetry.log`.
- `UPDATE: packages/server/src/plugins.ts` - hand each plugin a `Logger` that keeps its level.
- `CREATE: packages/sdk/test/log-levels.test.ts` - the cases in *Validation*.

## Steps

1. Write `log.ts` with `LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'` and `LOG_SEVERITY` as VS Code's `logLevelToOtlpSeverity`.
2. Write `loggerOf(write)` so that calling the result logs at info and each method logs at its own level.
3. Give `telemetry.log` a `level` argument that defaults to info, and pass it to `onEvent`, the event and the OTLP record.
4. Send an OTLP record to an `ahp-otlp://logs/{level}` subscription only when its severity is in the band.
5. Keep `ahp-otlp://logs` without a level as every record.
6. Make `HostContext.log` and `PluginHost.log` a `Logger`, built with `loggerOf`.
7. Wrap each `(line) => void` the host or the daemon receives from outside with `loggerOf`, so its callers can use the methods.

## Validation

- `packages/sdk/test/log-levels.test.ts` has these cases:
  - `log(line)` reaches `onEvent` at info, and `log.warn(line)` at warn.
  - The `log` event carries the level.
  - A subscriber on `ahp-otlp://logs/warn` gets warn and error records and no info record.
  - A subscriber on `ahp-otlp://logs` gets every record.
- The existing telemetry and plugin event cases pass unchanged.
- `pnpm typecheck` and `pnpm test:unit` pass.

## Resume

Built on 2026-11-09 and waits for review. The tests that built a plugin host with `log: () => {}` wrap it in `loggerOf`, because `PluginHost.log` is a `Logger`.

