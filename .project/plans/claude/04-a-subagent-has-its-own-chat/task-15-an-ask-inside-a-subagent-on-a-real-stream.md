---
title: A permission ask inside a subagent, seen on a real stream
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1709-L1760](../../../../packages/agent-claude/src/session.ts#L1709-L1760) - `canUseTool`, which joins an ask to its worker by `toolUseID`, then `agentID`"
  - "[code://test/agent-claude-subagent.test.ts#L194-L220](../../../../test/agent-claude-subagent.test.ts#L194-L220) - the ask case, a synthetic `canUseTool` call over the replay"
  - "[code://test/fixtures/claude-subagent.jsonl](../../../../test/fixtures/claude-subagent.jsonl) - the capture task 01 drew its conclusion from, whose inner tools are `ls -la` and `find`"
---

## Objective

A captured stream shows what the SDK does when a tool inside a subagent needs permission, and task 05's routing is tested against that order rather than a synthetic call.

## Files

- `CREATE: test/fixtures/claude-subagent-ask.jsonl` - one turn whose subagent needs a permission, trimmed, with each `canUseTool` call recorded in order as a line `{ "type": "canUseTool", "toolName", "input", "options" }` at the point it arrived.
- `UPDATE: test/agent-claude-subagent.test.ts:194-220`.
- `UPDATE: task-01-a-subagent-on-a-real-stream.md` or this task's Resume, with what was seen.

## Steps

1. Run the SDK as task 01 did, `permissionMode: 'default'`, `includePartialMessages` and `forwardSubagentText` on, with a prompt whose subagent must write a file or run a Bash command that is not read-only (for example "use a subagent to create notes.txt containing hello").
2. Record every message and every `canUseTool` call with its full options, in arrival order, and keep the capture script out of the repository.
3. If `canUseTool` is called for the inner tool, note whether its `toolUseID` was already seen in an `assistant` frame with that `parent_tool_use_id`, and whether `agentID` is set.
4. If it is not called, record that in Resume with the exact prompt and tools, and stop: the question returns to Softov.

## Validation

- The ask case in `test/agent-claude-subagent.test.ts` replays `claude-subagent-ask.jsonl`, calling the session's `canUseTool` at each recorded point with the recorded options, and expects the confirmation on the worker's chat, none on the lead chat, and the tool allowed after `confirm`.
- If the capture shows `canUseTool` before the worker's `assistant` frame, that case fails today, and the join is fixed so it passes.

## Resume
