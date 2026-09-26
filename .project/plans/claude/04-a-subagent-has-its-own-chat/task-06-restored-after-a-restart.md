---
title: A subagent's chat is there again after a restart
status: implemented
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

Built. `transcript.ts` gained `subagentsOf(sessionId, dir, mainTurns)`, which finds the session directory the CLI's way and reads `subagents/agent-<id>.meta.json` for `toolUseId`, `agentType` and `description`, then builds the worker's turns from `agent-<id>.jsonl` with the same builder the main transcript uses. `Agent.subagents?(id, turns)` returns them, and `claude()` passes the session's directory and the turns the host already read, so a restore does not read the transcript twice.

- A meta file without a `toolUseId`, or none at all, falls back to the tolerant `agentId: <id>` line at the end of the spawning call's result (`agentIdIn`). A worker neither names is skipped rather than linked to the wrong call.
- The host mints each worker's URI, lists it read-only on the session's `chats` with the `tool` origin, serves its own state when subscribed, and appends the `subagent` content to the spawning call in the restored transcript. `spelledFor` respells a worker URI into whichever session spelling the client used, and the `subagent` content with it, so a client comparing the two ends of the link finds one answer.
- `test/agent-claude-subagent-restore.test.ts` lays out a real session directory with one meta-linked worker, one linked only by the suffix and one with neither, and reads them back at the backend and through the host: the chat list, the worker's turns, the link on the call, and a refused turn on the read-only chat.

