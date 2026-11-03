---
title: A client tool's call names the tool
status: todo
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L44-L75](../../../../packages/agent-claude/src/session/stream.ts#L44-L75) - a call's `toolName`, the CLI's raw name"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L196-L213](../../../../packages/agent-claude/src/session/clienttools.ts#L196-L213) - the client tools' server name"
---

## Objective

A call of a client's tool carries the tool's own name, so the client that owns it finds the tool to run.

## Files

- `UPDATE: packages/agent-claude/src/session/stream.ts` - the client-tool prefix taken off `toolName` and `displayName`.

## Steps

1. Strip `mcp__ahp__<clientId>__` from a client tool's call name (row 29, E-0032).
2. Keep the prefix for the CLI's own answer to the call.

## Validation

- Add to `packages/agent-claude/test/agent-claude-contributed-tools.test.ts`: the call a client runs names its own tool.

## Resume

