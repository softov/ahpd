---
title: A permission ask inside a subagent is asked there
status: implemented
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

Built. `canUseTool` resolves the conversation a call is in from `options.toolUseID` against the scopes that already hold the call, remembers `options.agentID` against that scope for later asks, and falls back to the lead chat. The confirmation is opened, announced and said back with `emitOn` on that scope, and `entry.chat` names the worker's chat so a client reading `inputNeeded` knows where the question is. `confirm` finds the call's own scope, so an approval given in a worker's chat is echoed there.

Task 01 found the SDK never calls `canUseTool` for a tool inside a subagent, so the `agentID` half is implemented against the documented shape but was not observed live; the toolUseID join is what runs, and `test/agent-claude-subagent.test.ts` drives a `canUseTool` call with both `toolUseID` and `agentID` over the replay and checks the ask and the approval land on the worker's chat.

