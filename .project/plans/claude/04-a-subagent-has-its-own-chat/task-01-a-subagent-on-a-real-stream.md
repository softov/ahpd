---
title: A subagent seen on a real stream
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://test/fixtures/claude-empty-round.jsonl](../../../../test/fixtures/claude-empty-round.jsonl) - the capture shape to follow"
---

## Objective

A captured Claude stream shows what a subagent sends, with `forwardSubagentText` on: which frames carry `parent_tool_use_id`, the `task_started` and `task_notification` messages, and `canUseTool`'s `agentID`.

## Files

- `CREATE: test/fixtures/claude-subagent.jsonl` - one turn with a foreground `Task`, trimmed.
- `CREATE: test/fixtures/claude-subagent-background.jsonl` - one turn with a background `Task`, if the CLI starts one.

## Steps

1. Run the SDK with `includePartialMessages` and `forwardSubagentText` on and a prompt that makes Claude use `Task` (for example "use a subagent to list the files in this folder").
2. Record every message, and every `canUseTool` call with its options.
3. Repeat with a background agent (`run_in_background`), and with a subagent that starts a subagent if the CLI allows it.
4. Note the `subagents/agent-<id>.meta.json` written for each, and whether the `Task` result ends with an `agentId:` line.

## Validation

- The fixture has the `Task` `tool_use` in the main stream, frames with its id as `parent_tool_use_id` carrying text and a tool call, and the `tool_result` that ends it.
- *Resume* records what was found about `task_started`, `agentID` and the meta file.

## Resume

