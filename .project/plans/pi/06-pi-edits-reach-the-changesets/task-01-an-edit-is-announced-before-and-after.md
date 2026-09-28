---
title: An edit is announced before and after
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L454-L606](../../../../packages/agent-pi/src/session.ts#L454-L606) - `editing`, `announceEdit`, `settleEdit` and `heard`, where the events are seen"
  - "[code://packages/agent-cofold/src/session.ts#L237-L275](../../../../packages/agent-cofold/src/session.ts#L237-L275) - `editing`, `announceEdit`, `settleEdit` to copy"
---

## Objective

`piSession` calls `start.onFileEdit` with `before` when pi's `edit` or `write` starts and `after` when it ends, once each, for the absolute path.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - an `editing` map by tool call id; `heard` handles `tool_execution_start` and `tool_execution_end` for `edit` and `write`; `finish` settles what is left.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. On `tool_execution_start` with `toolName` `edit` or `write` and a string `args.path`, resolve it against `where`, keep it under `toolCallId`, and call `onFileEdit(turnId, path, 'before')`.
2. On `tool_execution_end` for a kept id, call `after` and forget it.
3. In `finish`, before `active` is cleared, call `after` for every id still kept, so every way a turn ends settles its own calls once.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: an `edit` with a relative path yields `before` and `after` for the absolute path under the session's directory, on the running turn's id; a `read` yields nothing; a call with no end gets its `after` at the settle; a turn whose `prompt` throws with an `edit` open sends that `after` on its own turn id and nothing on the next.
- `pnpm test`, `pnpm typecheck` green.

## Resume

Built 2026-09-27.
`piSession` keeps an `editing` map by pi's call id, with `announceEdit` and `settleEdit` as in `@ahpd/agent-cofold`.
`heard` announces `before` on `tool_execution_start` for `edit` and `write` with a string `path`, resolved with `piPath` against the working directory, and `after` on `tool_execution_end`.
`finish` settles every call still open before `active` is cleared, so a settle, a thrown `prompt` and a cancel each close their own calls on their own turn id.
Two cases in `packages/agent-pi/test/agent-pi.test.ts` drive the calls through `driveCall`: an `edit` on a relative path with a `read` beside it, and a `write` that never ends.
Before the fix both failed with `AssertionError: expected [] to deeply equal [ [ 't1', …(2) ], [ 't1', …(2) ] ]` and `expected [] to deeply equal [ [ 't1', …(2) ] ]`, because `onFileEdit` was never called.
The sweep first sat in `agent_settled`, and Softov moved it into `finish` on 2026-09-27.
The case `settles an open edit on its own turn when the prompt throws, and leaks nothing into the next` failed before that move with `AssertionError: expected [ [ 't1', …(2) ] ] to deeply equal [ [ 't1', …(2) ], [ 't1', …(2) ] ]`, because the thrown turn sent no `after`.
`node_modules/.bin/vitest run packages/agent-pi` green, 95 tests; `pnpm test` green, 1440 tests in 104 files; `pnpm typecheck` and `pnpm boundary` green.
