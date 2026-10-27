---
title: A Claude command shows its terminal
domain: host
status: planned
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/128-a-shell-commands-call-shows-its-terminal/plan.md
  - plans/host/128-p1-the-host-says-a-commands-terminal-as-it-opens/plan.md
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L325-L420](../../../../packages/agent-claude/src/session/turns.ts#L325-L420) - `runCommand`, the turn a `!` command is"
  - "[code://packages/sdk/test/host-terminals.test.ts](../../../../packages/sdk/test/host-terminals.test.ts) - the cases for a command typed into a Claude conversation"
---

## Goal

A Claude `!` call names its terminal only when the command has exited, and says `isPty: false` whatever the terminal is.
With this plan, it names the terminal as soon as the terminal opens, and says what the terminal is.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The call is held as a part from the start, `running`, with its ready's fields.
- The completion puts its result onto the held call and into the action, from one object.

### Runtime path

```
runCommand -> run(toolCallId, opened) -> opened: the content onto the call, and chat/toolCallContentChanged
  -> Ran -> the result onto the call, and chat/toolCallComplete
```

### Gaps

- A client sees no terminal on the call while the command runs.
- A client reads a pseudoterminal's output as plain text.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The terminal goes onto the held call and into `chat/toolCallContentChanged` as soon as it opens, with no `_meta`. | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L96-L104 | 01 |
| The terminal says `isPty` as the run says it, and nothing when the run says nothing. | `ToolResultTerminalContent.isPty` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |

## Proposed architecture

- **Data flow** - the terminal block is made once, from the run's terminal, and the completion adds its result.
- **Event flow** - `chat/toolCallContentChanged` between the ready and the completion.
- **State flow** - the held call holds the content a watching client holds.
- **Layer responsibilities** - `@ahpd/agent-claude`: its `!` call.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A Claude command shows its terminal](task-01-a-claude-command-shows-its-terminal.md) | todo | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-claude-command-shows-its-terminal.md](task-01-a-claude-command-shows-its-terminal.md).
- **Open questions:** none.
- **Watch out for:** a turn that ended before the terminal opened sends no content.

## Final verification checklist

- [ ] The new case fails on the session before this change.
- [ ] `plans/index.md` updated.
