---
title: A confirmation during streaming carries the input
status: done
depends: [task-01-tool-input-is-the-whole-input.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2157-L2164](../../../../packages/agent-claude/src/session.ts#L2157-L2164) - `canUseTool` moves a held call to `pending-confirmation` without its input"
  - "[code://packages/agent-claude/src/session.ts#L1733](../../../../packages/agent-claude/src/session.ts#L1733) - `assistant()` skips a call no longer streaming"
---

## Objective

When `canUseTool` finds the call already held and still streaming, the call gets `toolInput` from `toolInputOf` and loses `partialInput`, so the session's snapshot carries the whole input as the action does.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1941-1972` - the held branch.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the case below.

## Steps

1. Test first with the faked SDK: a stream opens a tool call, `canUseTool` asks before the assistant message arrives, and the snapshot's call has the whole `toolInput` and no `partialInput`.
2. Implement.

## Validation

- The new case fails first and passes after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
