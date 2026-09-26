---
title: A subagent seen on a real stream
status: implemented
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

Captured, real. `@anthropic-ai/claude-agent-sdk` 0.3.278 with `includePartialMessages` and `forwardSubagentText` on, prompt "use a subagent to list the files in this folder", `permissionMode: 'default'`, from `/github/ahpd/scratch-capture-subagent.mjs`. Two fixtures are trimmed from the two captures: `test/fixtures/claude-subagent.jsonl` (one foreground `Agent` call, 15 frames) and `test/fixtures/claude-subagent-background.jsonl` (a `run_in_background: true` call, 14 frames).

What the stream showed:

- A subagent's text, thinking and tool calls arrive as canonical `assistant` and `user` frames whose `parent_tool_use_id` is the spawning call's id. No `stream_event` carried a parent in either capture - every partial had `parent_tool_use_id: null` - so the routing has to read the canonical frames, not the deltas.
- The spawning `tool_use` is named `Agent` in 0.3.278 (not `Task`), with `{ subagent_type, description, prompt, run_in_background }`.
- `system:task_started` is sent for a foreground worker too, and carries `is_backgrounded` (false foreground, true background), `tool_use_id`, `description` and `subagent_type`. The plan's "a call named by `task_started` is background" is therefore wrong for this SDK: `is_backgrounded` is the discriminator, and the implementation uses it (task 04).
- A background worker's `tool_result` arrives immediately ("Async agent launched successfully") and its inner frames arrive after the main turn's `result`; `system:task_notification` with `tool_use_id` and a terminal `status` (`completed`, `failed`, `stopped`) is what ends it. A foreground worker also gets a `task_notification`, before its own `tool_result`.
- `system:task_progress` carries `tool_use_id` and a running line; `system:task_updated` carries `{ patch: { status } }`; `system:background_tasks_changed` lists the running tasks.
- `canUseTool` was not called for a tool inside a subagent, nor for the `Agent` call, so no `agentID` was observed live.
- That does not show the SDK skips the host's gate for inner tools: the only inner tools in both captures were `ls -la` and `find`, which the CLI approves by itself as read-only. Task 15 recaptures with an inner tool that needs a prompt.
- The subagent's meta file is real and exact: `subagents/agent-<id>.meta.json` holds `{ "agentType": "Explore", "description": ..., "toolUseId": "toolu_…", "spawnDepth": 1 }`, read from an existing session under `~/.claude/projects`. A foreground worker's spawning result is a `[Subagent hand-back]` text block with no `agentId:` line; a background worker's result does carry one (`agentId: af279e8136cb23ae9` in `claude-subagent-background.jsonl`, line 4). The meta file is the exact link for both, and the suffix is the fallback. Task 06 reads the meta file first.
- A nested subagent did not occur in either capture; its link is implemented per the reference and covered by a synthetic nested case in `test/subagent-chat.test.ts`.

