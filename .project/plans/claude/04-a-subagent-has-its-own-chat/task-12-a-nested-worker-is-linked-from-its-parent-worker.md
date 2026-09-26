---
title: A nested worker is linked from the worker chat that spawned it, live and restored
status: todo
depends: []
layer: "sdk, agent-claude"
refs:
  - "[code://packages/sdk/src/host.ts#L2831-L2893](../../../../packages/sdk/src/host.ts#L2831-L2893) - `openSubagent`, which writes a nested link with `dispatch` rather than `sendSubagent`"
  - "[code://packages/agent-claude/src/transcript.ts#L136-L170](../../../../packages/agent-claude/src/transcript.ts#L136-L170) - `subagentsOf`, which never sets `parentToolCallId`"
  - "[code://packages/sdk/src/host.ts#L4764-L4790](../../../../packages/sdk/src/host.ts#L4764-L4790) - `linkedTurns`, applied to the lead chat's turns only"
  - "[code://test/subagent-chat.test.ts#L111-L115](../../../../test/subagent-chat.test.ts#L111-L115) - the nested case, whose spawning call never exists in the parent worker's chat"
---

## Objective

A worker spawned inside another worker is linked from the call in that worker's chat: the live link is part of the parent worker's own state, and a restored nested worker names its parent worker as its origin.

## Files

- `UPDATE: packages/sdk/src/host.ts:2880-2893` - the nested link goes out with `dispatch(parentChat, ...)` and `turnsOf`, so the parent worker's reduced state never holds it.
- `UPDATE: packages/agent-claude/src/transcript.ts:136-170` - a restored worker's origin is always the lead chat.
- `UPDATE: packages/sdk/src/host.ts:4764-4790`, and the restored worker snapshot around `host.ts:5064-5098` - only the lead's turns are linked.
- `UPDATE: test/subagent-chat.test.ts`, `test/agent-claude-subagent-restore.test.ts`.

## Steps

1. In `openSubagent`, when `parentChat` is a worker chat in `subagents`, write the link with `sendSubagent(parentChat, ...)` and that worker's `turnId`, so `absorb` folds it into the parent's state.
2. In `subagentsOf`, after reading every worker, set `parentToolCallId` on a worker whose `toolCallId` is a tool call in another worker's turns rather than in the main turns.
3. When serving a restored worker's snapshot, run `linkedTurns` over its turns with the workers whose `parentToolCallId` is its own `toolCallId`.

## Validation

- `test/subagent-chat.test.ts`: the fake emits `chat/toolCallStart` and `chat/toolCallReady` for `toolu_inner` on the outer worker's chat before opening the inner worker (today it never does, so the link had no call to land on); a subscribe to the outer worker returns `toolu_inner` with the `subagent` content naming the inner chat. Fails today.
- `test/agent-claude-subagent-restore.test.ts`: `agent-a1.jsonl` gains a `tool_use` `toolu_nested`, and a worker `agent-d4` with meta `{ toolUseId: 'toolu_nested', spawnDepth: 2 }`; its row's origin `chat` is a1's worker URI, and a1's snapshot has the link on `toolu_nested`. Fails today.
- `pnpm typecheck` green.

## Resume
