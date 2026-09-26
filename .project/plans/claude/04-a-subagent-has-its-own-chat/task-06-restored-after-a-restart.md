---
title: A subagent's chat is there again after a restart
status: todo
depends: [task-03-subagent-frames-go-to-their-chat.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L382](../../../../packages/agent-claude/src/claude.ts#L382) - `stateFile`"
---

## Objective

A session read back from its transcript has each subagent's chat again, linked from the call that started it.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts` and `src/transcript.ts` - read `subagents/agent-<id>.meta.json` and `.jsonl`.
- `UPDATE: packages/sdk/src/host.ts` - a restored session lists its subagent chats.
- `CREATE: test/agent-claude-subagent-restore.test.ts`.

## Steps

1. For a session's transcript, list `subagents/*.meta.json` and read `toolUseId`, `agentType` and `description`.
2. Without a meta file or `toolUseId`, read the `agentId:` line at the end of the spawning call's result.
3. Build each subagent's turns from its `.jsonl` with the transcript reader the main chat uses.
4. List them as read-only chats with the `tool` origin, and put the `subagent` content on the spawning call in the main transcript.

## Validation

- A fixture session directory with one subagent reads back with its chat, its turns and the link.
- A missing meta file falls back to the suffix; one with neither is skipped without failing the session.

## Resume

