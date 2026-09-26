---
title: A cofold tool call is drawn and its edits are reported
status: implemented
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

Done.
Step 1: a cofold tool event reaches `chat/toolCall*` through `mapping.ts` and the builders in `tools.ts`; a capability tool is not in `offered`, so `displayNameOf` leaves its name alone.
The agent's `beforeTool`/`afterTool` in `agentOf` report a `write_file` or `edit_file` call through `start.onFileEdit`, with the path resolved against the session's workspace the way the files capability resolves it.
`before` goes out as the call is announced and `after` when it finishes.
A call that never finishes still sends the `after`: a policy denial (`tool.denied`), a declined approval (`approval.resolved` with `deny`), and a sweep when the run ends, so a client never holds a file as changing.
`tools.ts` gained `toolMetaOf`, which stamps `_meta.toolKind: 'terminal'` for `shell_exec`, and `intentionOf`, which is the command.
`mapping.ts` puts both on the `chat/toolCallStart` action and on the part a subscription reads.
What the plan did not know: cofold emits no `tool.denied` for a declined approval, which is why that path is handled too.
A declined approval's own tool-call row is left `pending-confirmation` by `mapping.ts`, which is pre-existing and outside this plan.
