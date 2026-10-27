---
title: A cofold command shows its terminal
domain: host
status: built
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/128-a-shell-commands-call-shows-its-terminal/plan.md
  - plans/host/128-p1-the-host-says-a-commands-terminal-as-it-opens/plan.md
refs:
  - "[code://packages/agent-cofold/src/turns.ts#L436-L510](../../../../packages/agent-cofold/src/turns.ts#L436-L510) - `runCommand`, the turn a `!` command is"
  - "[code://packages/agent-cofold/src/tools.ts#L278-L345](../../../../packages/agent-cofold/src/tools.ts#L278-L345) - the call part, which opens `streaming`, and the start and ready actions"
  - "[code://packages/agent-cofold/test/agent-cofold-approval.test.ts](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts) - the cases through the host"
---

## Goal

A cofold `!` call names its terminal only when the command has exited, and says `isPty: false` whatever the terminal is.
Its ready says `terminal` where the command belongs, and goes to clients and not onto the call the session holds.
So a client that subscribes while the command runs reads a `streaming` call that a watching client holds as `running`.
With this plan, the call is the reference's terminal call, held as a watching client holds it.
It names its terminal as soon as the terminal opens.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `toolReadyAction` says `describe(name)` as the invocation message, which is `terminal` for this call.
- The completion puts its result onto the held call, but not the ready's line or input.

### Runtime path

```
runCommand -> start (intention) -> ready onto the call -> run(toolCallId, opened)
  -> the content onto the call, and chat/toolCallContentChanged -> Ran -> the completion
```

### Gaps

- A client that subscribes during the command reads another call than a watching client.
- A client sees no terminal on the call while the command runs, and reads a pseudoterminal's output as plain text.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The call starts with the command as its intention, and its ready says the command as its line and its input. | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L67-L82 | 01 |
| The ready's fields go onto the held call and into the action, from one object, and the call is `running`. | [code://packages/agent-claude/src/session/stream.ts#L573-L583](../../../../packages/agent-claude/src/session/stream.ts#L573-L583) | 01 |
| The call names its terminal as soon as it opens, as a Claude call does. | p2 of this plan | 01 |

## Proposed architecture

- **Data flow** - the call's ready, its terminal and its result each go onto the held call from the object the action carries.
- **Event flow** - `chat/toolCallContentChanged` between the ready and the completion.
- **State flow** - the held call follows the reducer: `streaming`, `running` with its terminal, `completed`.
- **Layer responsibilities** - `@ahpd/agent-cofold`: its `!` call.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A cofold command shows its terminal](task-01-a-cofold-command-shows-its-terminal.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `toolReadyAction` serves cofold's own tools too, so the `!` call does not change it.

## Final verification checklist

- [x] The new case fails on the session before this change.
- [x] `plans/index.md` updated.
