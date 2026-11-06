---
title: Claude takes the record's model
status: todo
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L127-L137](../../../../packages/agent-claude/src/plugin.ts#L127-L137) - `open`"
  - "[code://packages/agent-claude/src/session.ts#L148-L150](../../../../packages/agent-claude/src/session.ts#L148-L150) - the stored model a session starts on"
---

## Objective

A session of a Claude record that names `model` starts on that model, when the agent offers it.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts:127-137` - pass `record.model` to `claude()`.
- `UPDATE: packages/agent-claude/src/claude.ts` - `model` in `ClaudeOptions`, handed to each session's options.
- `UPDATE: packages/agent-claude/src/session.ts:148-150` - start on the record's model when the stored settings name none.
- `UPDATE: packages/agent-claude/test/agent-claude-models.test.ts` - cases for a record model offered and not offered.

## Steps

1. Add `model?: string` to `ClaudeOptions`, with a one-line comment.
2. In `open`, pass `record.model` when the record names one, as acp does.
3. In `session.ts`, read the record's model when `settings.model` is absent, and leave `defaults` as it is.
4. Add a case: a record model the agent offers is the model of a new session.
5. Add a case: a record model the agent does not offer leaves the CLI's default.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-claude test` passes, run alone.

## Resume

- **Done so far:** nothing.
- **Found:** nothing yet.
