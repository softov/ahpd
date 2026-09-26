---
title: A cofold tool call is drawn and its edits are reported
status: todo
depends: [task-01-the-four-capabilities.md]
layer: "agent-cofold"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L187](../../../../packages/sdk/src/types/agent.ts#L187) - `onFileEdit`"
  - "[code://packages/agent-claude/src/session.ts#L932](../../../../packages/agent-claude/src/session.ts#L932) - the write tools Claude reports"
  - "[code://packages/agent-claude/src/session.ts#L2348-L2356](../../../../packages/agent-claude/src/session.ts#L2348-L2356) - `toolKind: 'terminal'`"
  - file:///github/cofold/packages/agents/src/types/hooks.ts - `beforeTool` and `afterTool`
---

## Objective

`write_file` and `edit_file` call `onFileEdit` before and after they run, with the resolved path, and `shell_exec` is drawn as a terminal with its command as the intention.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts` - `hooks` on the agent: `beforeTool`/`afterTool` for tools with `effects.writes` and a `path` input.
- `UPDATE: packages/agent-cofold/src/tools.ts` or the mapping - `shell_exec` drawn with `toolKind: 'terminal'`.

## Steps

1. Check first how the session maps cofold's tool events to `chat/toolCall*` today, for a tool that is not the host's; record it in *Resume*.
2. Add the hooks; the path is resolved against the session's workspace the way the files capability resolves it.
3. A call that was denied or failed still sends the `after`, so a client does not hold a file as changing.

## Validation

- A scripted `edit_file` turn: `onFileEdit` sees `before` then `after` for the same absolute path.
- A scripted `shell_exec` turn: the tool call part carries `toolKind: 'terminal'`.

## Resume
