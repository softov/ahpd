---
title: A subagent chat is restored from the CLI's own meta file
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-claude/src/claude.ts#L382](../../packages/agent-claude/src/claude.ts#L382) - `stateFile`, which already reads the CLI's transcript files directly"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/phase12-plan.md - the reference's strategy chain, needed because the SDK's replay API strips the correlation
---

## Context

After a restart or a resume, a subagent's chat has to be rebuilt from disk and tied to the tool call that spawned it. The CLI writes each subagent to `<session>/subagents/agent-<id>.jsonl`, with `agent-<id>.meta.json` beside it holding `agentType`, `description` and `toolUseId`. The reference reads transcripts through the SDK, whose replay messages carry no correlation, so it infers the link through a chain of strategies (a synthetic `agentId:` text suffix, then matching the prompt).

## Decision

This host reads `toolUseId` from the meta file, which it can because it already reads the CLI's transcript files directly. When a meta file is missing or has no `toolUseId`, it falls back to the `agentId:` suffix in the spawning call's result, as the reference does first. Source: (defaulted: the meta file is exact where the reference has to infer; Softov may overturn it).

## Consequences

Restoring is one read per subagent and cannot pair two identical prompts wrongly. It depends on a file layout the CLI does not document, so a CLI that stops writing the meta file falls through to the suffix.

## Options

- **The reference's strategy chain over the SDK's replay API.** Documented surface, but it infers what the meta file states, and its prompt match cannot tell two identical delegations apart.
