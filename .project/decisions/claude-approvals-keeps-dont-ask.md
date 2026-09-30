---
title: Claude's approval modes keep dontAsk, which VS Code's Claude host leaves out
status: accepted
date: 2026-09-29
refs:
  - "[code://packages/agent-claude/src/claude.ts#L174-L198](../../packages/agent-claude/src/claude.ts#L174-L198) - `permissionMode`, six values"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/claudeSessionConfigKeys.ts#L8-L29 - VS Code's five modes, `dontAsk` excluded on purpose
  - "[code://.project/decisions/stale-docs-are-corrected-in-one-task.md](stale-docs-are-corrected-in-one-task.md) - where `dontAsk` was added to match the SDK"
---

## Context

VS Code's Claude host offers five permission modes and leaves `dontAsk` out on purpose.
ahpd offers six, because the Claude Agent SDK has six, and `dontAsk` denies any tool call that is not already allowed instead of asking.
Claude plan 10 moves the other ahpd-only session keys (`outputStyle`, `thinking`, `sandboxEnabled`) out of the composer and into presets, to match VS Code.

## Decision

`permissionMode` keeps its six values, `dontAsk` included, while the other ahpd-only keys move into presets.

Source: Softov, 2026-09-29, asked "What happens to the ahpd-only composer chips once profiles exist?": "Move, but keep dontAsk".

## Consequences

The Approvals list in ahpapp has one mode more than VS Code's, and VS Code narrows a `dontAsk` it reads to nothing.
A session that runs unattended can still refuse instead of waiting on a person.

## Options

- **Five modes, as VS Code**: full parity, and an unattended session could only ask or allow.
