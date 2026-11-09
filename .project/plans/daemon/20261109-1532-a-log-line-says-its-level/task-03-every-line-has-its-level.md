---
title: Every line has its level
status: done
depends: [task-01-the-hosts-log-takes-a-level.md]
layer: "sdk, server, backends, plugins"
refs:
  - "[code://packages/sdk/src/host/telemetry.ts#L103-L166](../../../../packages/sdk/src/host/telemetry.ts#L103-L166) - where every line goes"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/log/common/log.ts#L909-L918 - the levels
---

## Objective

Each existing log call uses the method of its level.
The words of each line do not change.

## Files

- `UPDATE: packages/sdk/src` - each `log(...)` call uses its level's method.
- `UPDATE: packages/server/src` - each log call, and each `onProblem` and `warn` writer, uses its level.
- `UPDATE: packages/agent-claude/src` - each call of the log it was handed uses its level.
- `UPDATE: packages/agent-cofold/src` - each call of the log it was handed uses its level.
- `UPDATE: packages/agent-acp/src` - each call of the log it was handed uses its level.
- `UPDATE: packages/agent-pi/src` - each call of the log it was handed uses its level.
- `UPDATE: packages/computer/src` - each call of `host.log` uses its level.
- `UPDATE: packages/bot/src` - each call of `host.log` uses its level.
- `UPDATE: packages/webhook/src` - each call of `host.log` uses its level.

## Steps

1. List every log call with `rg -n "log\??\.?\(?\(" packages/*/src`, one package at a time.
2. Give error to a line that says something failed and nothing took its place.
3. Give warn to a line about a refusal, a skip, a retry or a fallback.
4. Give info to a line that says a session, chat, plugin or daemon changed state.
5. Give debug to a line that traces a step a person reads only to find a fault.
6. Leave the words of each line as they are.
7. Wrap each backend log option with `loggerOf` before the code calls a method on it.

## Validation

- `pnpm typecheck`, `pnpm boundary`, `pnpm test:unit` and `pnpm test:processes` pass.
- A test that reads a log line by its words still finds it.
- By hand: a refused session shows `[warning]`, a failed plugin load shows `[error]`, a session start shows `[info]`.

## Resume

Built on 2026-11-09 and merged in PR #259.

- 392 calls were read: 121 error, 141 warn, 14 debug, and the rest info, which stays a plain call.
- A module that takes a plain log callback passes the level as the second argument, as VS Code's `ILogger.log` takes one. Its callback type is `(line: string, level?: LogLevel) => void`, so a one-argument callback still fits.
- Each wrapper that prefixes a forwarded line passes the level through.
- The Windows update helper writes the same line shape, inline, because it imports nothing from the daemon.
- An ACP server's stderr lines stay info: the level the server wrote inside the line is not read.

