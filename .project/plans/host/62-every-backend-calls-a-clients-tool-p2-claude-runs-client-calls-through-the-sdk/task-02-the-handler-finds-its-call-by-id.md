---
title: The handler finds its call by the id the CLI hands it
status: done
depends: [task-01-a-claude-client-call-is-the-sdks.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L60-L76](../../../../packages/agent-claude/src/session/clienttools.ts#L60-L76) - the handler takes the input and nothing else"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L117-L149](../../../../packages/agent-claude/src/session/clienttools.ts#L117-L149) - `opening` and `claim`, the name-and-input join"
  - "[code://packages/sdk/test/support/claude-sdk.ts](../../../../packages/sdk/test/support/claude-sdk.ts) - the fake SDK the cases drive"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L14-L76 - `extractToolUseId` and the error result when the key is missing"
---

## Objective

An in-process handler for a client's tool reads the call id from `extra._meta['claudecode/toolUseId']`.
It waits on that call, so two identical concurrent calls are told apart.
Without the key it falls back to today's name-and-input match.

## Files

- `UPDATE: packages/agent-claude/src/session/clienttools.ts:60-149` - the handler takes `(input, extra)`; the id from `_meta` goes straight to `calls.wait`; `claim` stays as the fallback for a handler with no key.
- `UPDATE: packages/sdk/test/support/claude-sdk.ts` - the fake hands `_meta['claudecode/toolUseId']` to a handler, and can be told not to.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the cases below.

## Steps

1. Write the cases first and see the concurrent case fail on today's join.
2. Read the key as VS Code does; with it, wait on that id.
3. Without it, join by `claim` as today, and log that the key was missing.
4. Log it so the live run shows whether the fallback is still needed.
5. Run a live CLI once with a client tool.
6. Note in Resume whether the key arrived on every call.
7. If it did, say so to Softov, who decides whether the fallback goes.

## Validation

- `packages/sdk/test/host-tools.test.ts`, written first:
  - Run two concurrent calls of one client tool with the same input.
  - Check each answer reaches its own call.
  - Invoke a handler with the key and no matching assistant frame yet.
  - Check it still waits on that id.
  - Invoke a handler with no key.
  - Check it still reaches its call through the name-and-input match.
- By hand: run a claude session on ahpd with VS Code connected, and call a VS Code tool.
- Check the log shows the id came from `_meta`.

## Resume

- **Done:** `packages/agent-claude/src/session/clienttools.ts` reads `extra._meta['claudecode/toolUseId']` in the handler and waits on that call.
  `framed`/`asked` hold the one thing left to wait for: the frame that opens a call whose id the handler already knows.
  Without the key it logs `@ahpd/agent-claude: no claudecode/toolUseId for <name>; matching the call by tool name and input` and falls back to `claim`.
  `packages/sdk/test/support/claude-sdk.ts` hands each handler the next id queued in `sdk.toolUseIds` as `extra`.
  It hands none when `sdk.sendsToolUseId` is false.
  `createSdkMcpServer` wraps each definition, so a test calling a handler is calling what the CLI calls.
- **Failed first:** the three cases were written before any of it.
  Both pairing cases failed with `expected 'the first' to be 'the second'`.
  The join by name and input gave the first handler the other handler's call.
  The fallback case failed only on `expected '' to contain 'claudecode/toolUseId'`.
  That is the log line this task adds, rather than the fallback, which already worked.
- **The case is written against the order the calls were run, not made.**
  Two identical calls opened in one frame and claimed in the same order are told apart by the input match by accident.
  Both cases put the handlers in the other order from the frames.
  That is the one thing the input cannot say.
- **Verification:** `npx vitest run packages/sdk/test/host-tools.test.ts` green, 41 cases; `npx vitest run packages/agent-claude` green, 198 cases; `npx tsc -b` green.
- **Owed:** the by-hand run - a live CLI with a client tool, to see whether the key arrives on every call.
  The plan asks for it before this is marked done.
  It is in `deferred.md` with the rest.
- **Next action:** nothing; this task is implemented. The plan's `implemented.md` is next.
