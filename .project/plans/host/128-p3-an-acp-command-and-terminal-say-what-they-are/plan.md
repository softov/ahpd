---
title: An ACP command and terminal say what they are
domain: host
status: planned
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/128-a-shell-commands-call-shows-its-terminal/plan.md
  - plans/host/128-p1-the-host-says-a-commands-terminal-as-it-opens/plan.md
refs:
  - "[code://packages/agent-acp/src/session/queue.ts#L33-L135](../../../../packages/agent-acp/src/session/queue.ts#L33-L135) - `runCommand`, the turn a `!` command is"
  - "[code://packages/agent-acp/src/mapping.ts#L373-L392](../../../../packages/agent-acp/src/mapping.ts#L373-L392) - `contentBlocks`, which writes `isPty: false` on a terminal the server opened through the host"
  - "[code://packages/agent-acp/src/types.ts#L413-L424](../../../../packages/agent-acp/src/types.ts#L413-L424) - `AcpReach`, the session behind a turn as the mapping reaches it"
  - "[code://packages/agent-acp/src/session/turn.ts#L338-L355](../../../../packages/agent-acp/src/session/turn.ts#L338-L355) - where a turn's reach is made"
  - "[code://packages/agent-acp/src/session/context.ts#L195-L198](../../../../packages/agent-acp/src/session/context.ts#L195-L198) - the terminals the session opened, by their host name"
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - the cases through the host"
---

## Goal

An ACP `!` call names its terminal only when the command has exited, and says `isPty: false` whatever the terminal is.
A terminal the server opened through the host is shown with `isPty: false` as well.
With this plan, the `!` call names its terminal as soon as it opens, and both say what the terminal is.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The `!` call is held from the start, `running`, with its ready's fields.
- A server's terminal id is the host's name for it, and the session holds its handle by that name.
- A turn the transcript replays has no reach, and holds no handle.

### Runtime path

```
runCommand -> run(toolCallId, opened) -> the content onto the call, and chat/toolCallContentChanged -> Ran -> the completion
tool_call_update terminal -> contentBlocks -> turn.reach.isPty(uri) -> the block
```

### Gaps

- A client sees no terminal on a `!` call while the command runs.
- A client reads a pseudoterminal's output as plain text, on a `!` call and on a server's call.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The `!` call names its terminal as soon as it opens, as a Claude call does. | p2 of this plan, and https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L96-L104 | 01 |
| A server's terminal block says `isPty` as the handle says it, read through the turn's reach. | `ToolResultTerminalContent.isPty` in npm://@microsoft/agent-host-protocol@1.0.0, and `within` and `changed` on [code://packages/agent-acp/src/types.ts#L413-L424](../../../../packages/agent-acp/src/types.ts#L413-L424) | 01 |
| A replayed turn's terminal block says no `isPty`, because no handle says it. | `isPty` is optional in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |

## Proposed architecture

- **Data flow** - the `!` call's block comes from the run's terminal; a server's block asks the reach.
- **Event flow** - `chat/toolCallContentChanged` between the `!` call's ready and its completion.
- **State flow** - the held call holds the content a watching client holds.
- **Layer responsibilities** - `@ahpd/agent-acp`: its `!` call and its server's terminal blocks.
- **Source-of-truth files** - [`code://packages/agent-acp/src/session/queue.ts`](../../../../packages/agent-acp/src/session/queue.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An ACP command and terminal say what they are](task-01-an-acp-command-and-terminal-say-what-they-are.md) | todo | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-acp-command-and-terminal-say-what-they-are.md](task-01-an-acp-command-and-terminal-say-what-they-are.md).
- **Open questions:** none.
- **Watch out for:** the server's fixture waits for its terminal to exit.

## Final verification checklist

- [ ] The new case fails on the session before this change.
- [ ] `plans/index.md` updated.
