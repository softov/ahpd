---
title: A spawning call carries the reference's subagent _meta, under its names
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-claude/src/session.ts#L1448-L1548](../../packages/agent-claude/src/session.ts#L1448-L1548) - where a `Task` or `Agent` call is recorded and its `chat/toolCallReady` is emitted, today with `_meta.toolKind` only"
  - "[code://packages/sdk/src/host.ts#L1826-L1848](../../packages/sdk/src/host.ts#L1826-L1848) - `dispatch`, the one funnel every chat action passes through"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts - `buildTopLevelSubagentReadyAction`, which sets `subagentDescription` and `subagentAgentName` on the spawning call's ready action
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentSideEffects.ts#L805-L812 - the reference host stamping `subagentChatUri` on any call whose `toolKind` is `subagent`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/meta/agentToolCallMeta.ts#L31-L36 - the three keys and what each means
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L373-L401 - the workbench reading them to draw the subagent row
---

## Context

The protocol links a spawning call to its worker chat through a `subagent` tool-result content, and ahpd sends that.
The reference also puts three `_meta` keys on the spawning call: `subagentDescription` and `subagentAgentName` from the call's input, and `subagentChatUri`, the worker chat's URI, stamped by the host as soon as the call is known to spawn one.
VS Code's workbench reads the first two to draw the task description and agent name on the call, and prefers the third when it opens the worker chat, so without them the row has no description and the link exists only once the chat has opened.
The keys are not protocol; they are VS Code's.

## Decision

The spawning call carries `_meta.subagentDescription` and `_meta.subagentAgentName`, set by the backend from the call's `description` and `subagent_type`, and `_meta.subagentChatUri`, stamped by the host on every call whose `_meta.toolKind` is `subagent`, under exactly the reference's names.
Source: Softov, 2026-09-26, asked "Should ahpd send VS Code's `_meta.subagentDescription`, `subagentAgentName` and `subagentChatUri`, to match VS Code by the same names, even though they aren't in the protocol?": "Send VS Code's `_meta.subagentDescription`, `subagentAgentName` and `subagentChatUri`, under VS Code's names (upstream parity is the goal)."

## Consequences

VS Code draws the subagent row with its description and can open the worker chat from the call before the chat is announced.
The host stays the only thing that spells a chat URI: the backend never learns the shape, because the host stamps `subagentChatUri` in `dispatch` and in the snapshot it serves.
Another client reads the protocol's `subagent` content and ignores the keys.

## Options

- **The protocol's `subagent` content alone.** Nothing outside the protocol on the wire, but VS Code draws the call without a description and cannot reach a chat that has not opened yet.
- **Keys of ahpd's own naming.** No client reads them.
