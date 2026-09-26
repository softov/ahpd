---
title: The spawning call carries the reference's subagent _meta
status: todo
depends: [task-08-the-host-holds-only-a-workers-call-content.md]
layer: "agent-claude, sdk"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1448-L1548](../../../../packages/agent-claude/src/session.ts#L1448-L1548) - `assistant`, where a spawning call is recorded and its ready action emitted"
  - "[code://packages/agent-claude/src/kinds.ts#L43](../../../../packages/agent-claude/src/kinds.ts#L43) - `toolMetaOf`, which already sets `toolKind: 'subagent'` for `Task` and `Agent`"
  - "[code://packages/sdk/src/host.ts#L1826-L1848](../../../../packages/sdk/src/host.ts#L1826-L1848) - `dispatch`"
  - "[code://packages/sdk/src/host.ts#L5046-L5052](../../../../packages/sdk/src/host.ts#L5046-L5052) - the snapshot of a live chat, read from the backend"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentSideEffects.ts#L805-L812 - the reference's stamp
---

## Objective

Per [A spawning call carries the reference's subagent _meta](../../../decisions/a-spawning-call-carries-the-reference-subagent-meta.md), a `Task` or `Agent` call carries `_meta.subagentDescription`, `_meta.subagentAgentName` and `_meta.subagentChatUri` on the wire and in every snapshot.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1448-1548` - the spawning call's `_meta` has `toolKind` only.
- `UPDATE: packages/sdk/src/host.ts:1826-1848` - `dispatch` stamps nothing.
- `UPDATE: packages/sdk/src/host.ts:5046-5052` - a live chat's snapshot is the backend's `chatState()` as it is.
- `UPDATE: test/agent-claude-subagent.test.ts`, `test/subagent-chat.test.ts`.

## Steps

1. In `assistant`, for a `Task` or `Agent` block, add `subagentDescription` from `description` and `subagentAgentName` from `subagent_type` to the call's `_meta`, when present, on the call part and on its `chat/toolCallStart` and `chat/toolCallReady`.
2. In `dispatch`, on `chat/toolCallStart`, `chat/toolCallDelta` and `chat/toolCallReady` whose `_meta.toolKind` is `subagent` and which carry no `subagentChatUri`, add `subagentChatUri: subagentChatUri(session, toolCallId)` before the action is kept or broadcast.
3. In the live snapshot path, stamp the same key on every tool call in the chat's turns and active turn whose `_meta.toolKind` is `subagent`, so a late subscriber reads what the wire said.
4. `spelledFor` respells `subagentChatUri` with the session, as it already does the `subagent` content.

## Validation

- `test/agent-claude-subagent.test.ts`: the lead's `chat/toolCallReady` for the `Agent` call has `_meta` `{ toolKind: 'subagent', subagentDescription: 'List files in folder', subagentAgentName: 'Explore' }`; fails today.
- `test/subagent-chat.test.ts`: the fake's `toolCallStart` carries `_meta: { toolKind: 'subagent' }` (it carries none today, which is why nothing could be stamped); the wire's start for `toolu_task` has `_meta.subagentChatUri` equal to the worker URI, and a subscribe to the lead chat returns the call with it; the protocol checker case stays green. Fails today.
- `pnpm typecheck` green.

## Resume
