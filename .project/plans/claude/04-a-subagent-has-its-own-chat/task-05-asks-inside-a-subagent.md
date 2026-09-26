---
title: A permission ask inside a subagent is asked there
status: todo
depends: [task-03-subagent-frames-go-to-their-chat.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1478](../../../../packages/agent-claude/src/session.ts#L1478) - `canUseTool`"
---

## Objective

When a tool inside a subagent needs permission, the ask is drawn on the subagent's chat, against the tool call already there.

## Files

- `UPDATE: packages/agent-claude/src/session.ts`.
- `UPDATE: test/agent-claude-subagent.test.ts`.

## Steps

1. Map `agentID` to the spawning call: from the first `canUseTool` whose `toolUseID` is a tool call already seen in a subagent's scope, or from what task 01 found.
2. Emit the confirmation on that subagent's chat and turn.
3. An answer given there resolves the same `canUseTool`.

## Validation

- A replay with an ask inside a subagent puts the pending confirmation on the subagent chat, and approving it there lets the tool run.

## Resume

