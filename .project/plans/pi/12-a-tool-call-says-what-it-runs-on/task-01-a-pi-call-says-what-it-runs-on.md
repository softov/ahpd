---
title: A pi call says what it runs on, live and replayed
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L171-L178](../../../../packages/agent-pi/src/mapping.ts#L171-L178) - `readyRow`"
  - "[code://packages/agent-pi/src/mapping.ts#L281-L327](../../../../packages/agent-pi/src/mapping.ts#L281-L327) - `tool_execution_end`"
  - "[code://packages/agent-pi/src/types.ts#L100-L104](../../../../packages/agent-pi/src/types.ts#L100-L104) - `PiCall`"
  - "[code://packages/agent-pi/src/session.ts#L369-L405](../../../../packages/agent-pi/src/session.ts#L369-L405) - `askBefore`"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L1698-L1719](../../../../packages/agent-pi/test/agent-pi.test.ts#L1698-L1719) - the replayed read call's expectations"
---

## Objective

A pi call's `invocationMessage` and `pastTenseMessage` are its command, path or pattern, on the ready action, the asked call, the complete action, and after a reload.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts` - `describe(name, args)` per the plan's table; `readyRow` sets `invocationMessage` from it and keeps it on `PiCall`; `tool_execution_end` uses it for both messages.
- `UPDATE: packages/agent-pi/src/types.ts:100-104` - `PiCall.said`, what the call was described as.
- `UPDATE: packages/agent-pi/src/session.ts:369-405` - the asked call's `invocationMessage` from `describe`; the confirmation title stays `Run <name>?`.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. Replay goes through `readyRow` and the mapping, so it follows without its own change.

## Validation

- A live `bash` call with `{ command: 'ls -la' }` has `invocationMessage` and `pastTenseMessage` `ls -la`; a `read` of `a.ts` has `a.ts`; `ls` with no path has `.`; an unknown tool keeps its name; each fails first.
- The replay case at 1698-1719 expects `a.ts`.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- **Done:** `describe(name, input)` in `packages/agent-pi/src/mapping.ts` per the plan's table; an empty or missing argument falls back to the name, except `ls`, which falls back to `.`.
- `readyRow` sets `invocationMessage` from `describe`, so the hook's ready, the asked call's row and replay all follow.
- `askBefore` in `session.ts` sends `invocationMessage: describe(displayName, input)` on `chat/toolCallReady`; the confirmation title stays `Run <name>?`.
- `PiCall.said` holds the description; `tool_execution_end` uses `call.said ?? call.displayName` for `pastTenseMessage` and for the ready it sends an unreadied call.
- **Departure:** `said` is set in `mapEvent`'s `tool_execution_start`, which carries pi's `args` live and in replay, rather than in `readyRow`, which is handed the row and not the `PiCall`. The effect is the same for every call pi runs; a call pi fails before `tool_execution_start` has no arguments to describe and keeps its name.
- **Tests:** in `packages/agent-pi/test/agent-pi.test.ts`: "draws a live %s call by what it runs on, while it runs and once it is done" (10 cases: `bash`, `powershell`, `read`, `edit`, `write`, `grep`, `find`, `ls` with a path, `ls` with none, an unknown tool), "draws an asked call by what it runs on, and keeps the tool in its question"; "rebuilds a session it never watched from pi file, with the parts a live turn has" now expects `a.ts` for both messages.
- **Failed first:** the nine described cases, the asked case and the replay case failed with the tool name where the argument was expected; the unknown-tool case passed before and after.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1550 passed of 1550 in 108 files.
