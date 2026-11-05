---
title: Claude takes the record's model
status: todo
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L125-L135](../../../../packages/agent-claude/src/plugin.ts#L125-L135) - `open`"
---

## Objective

A session of a Claude record that names `model` starts on that model, when the agent offers it.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts:125-135` - pass `record.model` to `claude()`.
- `UPDATE: packages/agent-claude/src/claude.ts` - `model` in `ClaudeOptions`, and in `defaults`.
- `UPDATE: packages/agent-claude/test/agent-claude-models.test.ts` - cases for a record model offered and not offered.

## Steps

1. Add `model?: string` to `ClaudeOptions`, with a one-line comment.
2. In `open`, pass `record.model` when the record names one, as acp does.
3. In `defaults`, add `model` when the options name one.
4. Add a case: a record model the agent offers is the model of a new session.
5. Add a case: a record model the agent does not offer leaves the CLI's default.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-claude test` passes, run alone.

## Resume

- **Done so far:** nothing.
- **Found:** nothing yet.
