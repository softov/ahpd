---
title: The handler finds its call by the id the CLI hands it
status: todo
depends: [task-01-a-claude-client-call-is-the-sdks.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L60-L76](../../../../packages/agent-claude/src/session/clienttools.ts#L60-L76) - the handler takes the input and nothing else"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L117-L149](../../../../packages/agent-claude/src/session/clienttools.ts#L117-L149) - `opening` and `claim`, the name-and-input join"
  - "[code://packages/sdk/test/support/claude-sdk.ts](../../../../packages/sdk/test/support/claude-sdk.ts) - the fake SDK the cases drive"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L14-L76 - `extractToolUseId` and the error result when the key is missing"
---

## Objective

An in-process handler for a client's tool reads the call id from `extra._meta['claudecode/toolUseId']` and waits on that call, so two identical concurrent calls are told apart; without the key it falls back to today's name-and-input match.

## Files

- `UPDATE: packages/agent-claude/src/session/clienttools.ts:60-149` - the handler takes `(input, extra)`; the id from `_meta` goes straight to `calls.wait`; `claim` stays as the fallback for a handler with no key.
- `UPDATE: packages/sdk/test/support/claude-sdk.ts` - the fake hands `_meta['claudecode/toolUseId']` to a handler, and can be told not to.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the cases below.

## Steps

1. Write the cases first and see the concurrent case fail on today's join.
2. Read the key as VS Code does; with it, wait on that id.
3. Without it, join by `claim` as today and log that the key was missing, so the live run shows whether the fallback is still needed.
4. Run a live CLI once with a client tool and note in Resume whether the key arrived on every call; if it did, say so to Softov, who decides whether the fallback goes.

## Validation

- `packages/sdk/test/host-tools.test.ts`, written first:
  - two concurrent calls of one client tool with the same input: each answer reaches its own call.
  - a handler invoked with the key and no matching assistant frame yet still waits on that id.
  - a handler with no key still reaches its call through the name-and-input match.
- By hand: a claude session on ahpd with VS Code connected calls a VS Code tool, and the log shows the id came from `_meta`.

## Resume
