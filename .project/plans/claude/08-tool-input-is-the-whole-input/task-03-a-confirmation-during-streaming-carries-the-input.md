---
title: A confirmation during streaming carries the input
status: implemented
depends: [task-01-tool-input-is-the-whole-input.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1941-L1972](../../../../packages/agent-claude/src/session.ts#L1941-L1972) - `canUseTool` moves a held call to `pending-confirmation` without its input"
  - "[code://packages/agent-claude/src/session.ts#L1543](../../../../packages/agent-claude/src/session.ts#L1543) - `assistant()` skips a call no longer streaming"
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

Implemented 2026-09-30.
In `canUseTool` in `packages/agent-claude/src/session.ts`, a held call still `streaming` loses `partialInput` and takes `toolInput` from `toolInputOf` before it moves to `pending-confirmation`, so the snapshot and the pending confirmation's `toolCall` carry the whole input as `chat/toolCallReady` does. A held call already `running` is left as it was, since the assistant message gave it `toolInput` already.
`packages/agent-claude/test/agent-claude-tool-input.test.ts` adds one case: the faked query now hands its `canUseTool` to the test and can stay open after its frames; a stream opens a WebFetch call with half its json, `canUseTool` asks before any assistant message, and the snapshot's call is `pending-confirmation` with the whole input in `toolInput`, no `partialInput`, and the same `toolInput` on the ready action.
What failed first: the snapshot's `toolInput` was absent, so parsing it threw.
What the plan did not know: the check has to read the status before the branch sets `pending-confirmation`, which the same block does.
Gates: `pnpm typecheck`, `pnpm boundary` and the full `pnpm test` exit 0 (121 files, 1756 tests).
