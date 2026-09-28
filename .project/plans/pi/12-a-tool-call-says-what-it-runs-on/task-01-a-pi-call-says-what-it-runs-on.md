---
title: A pi call says what it runs on, live and replayed
status: todo
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
