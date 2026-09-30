---
title: The scheme and provider mismatch is reported upstream
status: todo
depends: []
layer: "upstream"
refs:
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/agent.ts - `AgentSession.provider()` returns the URI scheme
  - https://github.com/microsoft/agent-host-protocol - where the issue is filed
---

## Objective

An issue on the agent-host-protocol repository asks whether a session URI's scheme must be its provider, since `createSession` takes the channel and the provider separately and VS Code routes on the scheme.

## Files

- None in this repository.

## Steps

1. Draft the issue: what `createSession` allows, what VS Code assumes, the empty view it causes, and the question; cite only VS Code and the spec.
2. Show Softov the text in chat, and post it only after he approves the words.

## Validation

- The issue's URL is in this task's Resume.

## Resume
