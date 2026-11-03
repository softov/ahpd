---
title: An async command is a row
status: todo
depends: []
layer: "@ahpd/sdk tools, host"
refs:
  - "[code://packages/sdk/src/host/background.ts#L55-L146](../../../../packages/sdk/src/host/background.ts#L55-L146) - `rowOf`, `heldTasks` and `stop`"
  - "[code://packages/sdk/src/types/background.ts#L23-L61](../../../../packages/sdk/src/types/background.ts#L23-L61) - `BackgroundTask`"
  - "[code://packages/agent-claude/src/session/workers.ts#L455-L470](../../../../packages/agent-claude/src/session/workers.ts#L455-L470) - a shell row with its terminal"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L396-L402](../../../../packages/sdk/src/host/vscodemethods.ts#L396-L402) - the stop method"
---

## Objective

The shell tool takes `mode`, `sync` by default.
With `async`, the tool starts the command, answers at once with the shell id, and keeps the shell busy.
The command is a background row on the call's chat, with its command, its terminal and a stop that interrupts it.

## Files

- `UPDATE: packages/sdk/src/tools/shell.ts` - `mode` in the schema of `bash` and `powershell`, and the async answer.
- `UPDATE: packages/sdk/src/host/shells.ts` - start a command without waiting, and keep the shell busy until it ends.
- `UPDATE: packages/sdk/src/types/host.ts:1137-1318` - a way for a tool to set and remove a background row on its chat.
- `UPDATE: packages/sdk/src/host/tooling.ts:1706` - `toolContext` builds it on the chat's background tasks.
- `CREATE: packages/sdk/test/shell-async.test.ts` - the cases.

## Steps

1. Add `mode` with `sync` and `async` to the shell tool's schema, `sync` by default.
2. Start an async command in the shell manager and keep its shell busy.
3. Answer at once with the shell id, and say that the end wakes the session.
4. Give `ToolCall` a background row method, built on the chat's background tasks.
5. Set a shell row with the command, the terminal and a stop.
6. Make the stop send an interrupt to the shell, then end the row.
7. Remove the row when the command ends or the shell exits.
8. Write the tests.

## Validation

- `shell-async.test.ts`: an async command answers before it ends, with the shell id.
- `shell-async.test.ts`: `chat/backgroundWorkSet` names the command and the terminal.
- `shell-async.test.ts`: `vscode/stopBackgroundWork` interrupts it and removes the row.
- `shell-async.test.ts`: a second command does not get the busy shell.
- `pnpm --filter @ahpd/sdk test` passes.

## Resume
