---
title: A cofold call says what it runs on, live and replayed
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L267-L296](../../../../packages/agent-cofold/src/tools.ts#L267-L296) - `toolReadyAction` and `toolCompleteAction`"
  - "[code://packages/agent-cofold/src/mapping.ts#L487-L540](../../../../packages/agent-cofold/src/mapping.ts#L487-L540) - `invocationMessage` and `pastTenseMessage` from `held.name`"
  - "[code://packages/agent-cofold/src/transcript.ts#L84-L146](../../../../packages/agent-cofold/src/transcript.ts#L84-L146) - the transcript's `invocationOf` and `pastTenseMessage`"
---

## Objective

A cofold call's `invocationMessage` and `pastTenseMessage` are its command, path, pattern, URL or query, live and read back.

## Files

- `UPDATE: packages/agent-cofold/src/tools.ts` - `describe(name, input)` per the plan's table, used by `toolReadyAction` and `toolCompleteAction`.
- `UPDATE: packages/agent-cofold/src/mapping.ts`, `packages/agent-cofold/src/transcript.ts` - the same where they fall back to the name; an approval's prompt stays the confirmation title.
- `UPDATE: packages/agent-cofold/test/` - the cases below.

## Steps

1. Live and read-back messages match for the same call.

## Validation

- `shell_exec` with `ls` has `ls` for both messages, `read_file` of `a.ts` has `a.ts`, `web_fetch` has its URL, live and from the transcript; each fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume
