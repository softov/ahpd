---
title: A restored worker chat takes the same title
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L140-L160](../../../../packages/agent-claude/src/transcript.ts#L140-L160) - the worker chats read from `subagents/*.meta.json`"
---

## Objective

A worker chat restored from the transcript is titled by the same rule as a live one, from the `description` and `agentType` in its `.meta.json`.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts` - `title` from the shared `titleOf`.
- `UPDATE: packages/agent-claude/test/` - a restored worker with a description, and one with only an agent type.

## Steps

1. Export `titleOf` from where task 01 puts it, or from a small module both import, and use it here.
2. Confirm the restored first turn already carries the prompt from the worker's first user line; add a test either way.

## Validation

- A `.meta.json` with `description: "Rewrite refs: host 49, 50"` restores a chat with that title and a first turn whose text is the prompt.

## Resume

