---
title: A pi command is a terminal call
domain: host
status: planned
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/128-a-shell-commands-call-shows-its-terminal/plan.md
  - plans/host/128-p1-the-host-says-a-commands-terminal-as-it-opens/plan.md
refs:
  - "[code://packages/agent-pi/src/session.ts#L1115-L1160](../../../../packages/agent-pi/src/session.ts#L1115-L1160) - `runCommand`, the turn a `!` command is"
  - "[code://packages/agent-pi/test/agent-pi-declared.test.ts](../../../../packages/agent-pi/test/agent-pi-declared.test.ts) - the case through the host"
---

## Goal

A pi `!` call is named `shell`, shown as the command itself, and its input is the command as JSON.
A client draws a shell by the name `terminal`, so it draws this call as a tool it does not know.
The call never names the terminal the host ran the command in, so a client cannot watch it or read it after.
With this plan, the call is the reference's terminal call, and it names its terminal as soon as it opens.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "'shell'" packages/agent-pi/src` - the `!` call is the only call named `shell`; the auto-approval kind is another use of the word.
- The call's completion holds the output as text, and no terminal block.

### Runtime path

```
runCommand -> start (terminal, Terminal, intention) -> ready onto the call -> run(toolCallId, opened)
  -> the content onto the call, and chat/toolCallContentChanged -> Ran -> the completion with the terminal and the output
```

### Gaps

- A client draws the call as an unknown tool, and sees no terminal on it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The call is named `terminal`, shown as `Terminal`, with the command as its intention, its line and its input. | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L67-L82 | 01 |
| The call names its terminal as soon as it opens, and completes with the terminal and the output, as a Claude call does. | p2 of this plan | 01 |

## Proposed architecture

- **Data flow** - the call's ready, its terminal and its result each go onto the held call from the object the action carries.
- **Event flow** - `chat/toolCallContentChanged` between the ready and the completion.
- **State flow** - the held call holds the content a watching client holds.
- **Layer responsibilities** - `@ahpd/agent-pi`: its `!` call.
- **Source-of-truth files** - [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A pi command is a terminal call](task-01-a-pi-command-is-a-terminal-call.md) | todo | - |

## Risks and tradeoffs

- A client that read the call by the name `shell` reads it by `terminal`.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-pi-command-is-a-terminal-call.md](task-01-a-pi-command-is-a-terminal-call.md).
- **Open questions:** none.
- **Watch out for:** the call's id stays `<turn>:shell`, because an id is the session's to choose.

## Final verification checklist

- [ ] The new case fails on the session before this change.
- [ ] `plans/index.md` updated.
