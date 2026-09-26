---
title: A background worker is linked from its call when the call completes
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-claude/src/session.ts#L1655-L1692](../../packages/agent-claude/src/session.ts#L1655-L1692) - the spawning call's completion and `workerBlock`, which finds no worker for a background call"
  - "[code://packages/sdk/src/host.ts#L2880-L2893](../../packages/sdk/src/host.ts#L2880-L2893) - `openSubagent` writing the link with `turnsOf.get(parentChat) ?? ''`"
  - "[code://test/fixtures/claude-subagent-background.jsonl](../../test/fixtures/claude-subagent-background.jsonl) - the call's `tool_result` (line 4) before any frame of its worker (line 7)"
  - "[decisions/a-spawning-call-carries-the-reference-subagent-meta.md](a-spawning-call-carries-the-reference-subagent-meta.md) - the `subagentChatUri` stamp, the other half of this"
---

## Context

A background `Agent` call's `tool_result` says only that the worker was launched, and it arrives before any frame of the worker.
The backend opens a worker's chat on the worker's first frame, so when the call completes there is no chat, and the completion carries no `subagent` content.
When the chat opens later, the lead turn has ended, and the host writes the link with an empty turn id, which a reducer drops.
The chat's origin then names the call while the call never names the chat, which the protocol forbids, until a restart rebuilds the link from disk.

## Decision

Both: the backend opens a background worker's chat when its spawning call's `tool_result` arrives, so the completion carries the `subagent` content, and the host stamps `_meta.subagentChatUri` on the call as the reference does.
The host writes no `chat/toolCallContentChanged` when the spawning call's chat has no open turn.
Source: Softov, 2026-09-26, asked "The background link: (a) put the link on the completion when the `tool_result` arrives, as soon as `spawning` knows the call, (b) stamp `_meta.subagentChatUri` like VS Code and accept the gap, or (c) both?": "both".

## Consequences

The two ends of a background worker's link agree from the moment the call completes.
A background worker's chat is announced before its first frame, with its turn open and nothing in it yet.

## Options

- **Only the completion link.** Protocol-correct, but VS Code still has no URI on the call before completion.
- **Only the `_meta` stamp, as the reference does.** The protocol's `subagent` content stays missing for background workers until a restart.
