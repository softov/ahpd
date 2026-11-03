---
title: A confirmation shows the model's command
status: todo
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/config.ts](../../../../packages/agent-claude/src/session/config.ts) - the shell's environment and init script put in front of every Bash command"
  - "[code://packages/agent-claude/src/session/asking.ts#L360-L372](../../../../packages/agent-claude/src/session/asking.ts#L360-L372) - the confirmation built from the rewritten input"
---

## Objective

A Bash call's confirmation shows the command the model wrote, whatever the host puts in front of it to run.

## Files

- `UPDATE: packages/agent-claude/src/session/asking.ts` - the confirmation's input and line from the model's command.

## Steps

1. Build the confirmation from the command the model wrote (row 30, E-0066).
2. Keep the prefix on the command the CLI runs.

## Validation

- `packages/sdk/test/host-tool-confirm.test.ts`: a Claude Bash confirmation shows no export or sourcing line.

## Resume

