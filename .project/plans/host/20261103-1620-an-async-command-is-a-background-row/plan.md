---
title: An async command is a background row
domain: host
status: planned
priority: medium
created: 2026-11-03
revalidated: 2026-11-03
requires:
  - plans/host/20261103-1620-the-agent-terminal-tool/plan.md
changes:
  - specs/agent-backends.md
refs:
  - git://14beb809 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/background.ts#L24-L146](../../../../packages/sdk/src/host/background.ts#L24-L146) - the background rows: `rowOf`, `heldTasks` and `stop`"
  - "[code://packages/sdk/src/types/background.ts#L23-L61](../../../../packages/sdk/src/types/background.ts#L23-L61) - `BackgroundTask` and `BackgroundTasks`"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L396-L402](../../../../packages/sdk/src/host/vscodemethods.ts#L396-L402) - `vscode/stopBackgroundWork`, already built"
  - "[code://packages/agent-claude/src/session/workers.ts#L455-L562](../../../../packages/agent-claude/src/session/workers.ts#L455-L562) - Claude's background shells as rows with their terminal: the pattern to copy"
  - "[code://packages/sdk/src/host/wakes.ts#L84-L152](../../../../packages/sdk/src/host/wakes.ts#L84-L152) - `begin`, which starts a woken turn, and `setWake`, which holds one wake for each chat"
  - "[code://packages/sdk/src/host/tooling.ts#L1891-L1908](../../../../packages/sdk/src/host/tooling.ts#L1891-L1908) - `scheduleWake`, which keeps the sender with the wake"
  - "[code://packages/sdk/src/tools/session.ts#L786-L821](../../../../packages/sdk/src/tools/session.ts#L786-L821) - `schedule_wakeup`"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `BackgroundShellWork` in `channels-chat/state.ts`, with `command` and `terminal`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L765-L816 - the description that promises `mode=async`
---

## Goal

An agent starts a long command, such as a server, with `mode=async`, and gets its shell id at once while the command keeps running.
The command is a background row in the chat with its terminal and a stop button, as VS Code draws a background shell.
When the command ends, the row goes and the session is woken with the end of its output.
VS Code's description promises `mode=async`, and VS Code's own tool does not build it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "backgroundWorkSet|STOP_FLAG" packages/*/src` - the sdk owns the rows, and Claude and ACP use them.
- `rg -n "setWake|scheduleWake" packages/sdk/src` - a chat holds one wake, so the end of a command must not replace the one the model set.

### Runtime path

```
bash { mode: async } -> shell manager starts the command -> answer: the shell id
  -> background row { command, terminal, stop } -> the D mark or the sentinel -> row removed -> a woken turn with the output's end
```

### Gaps

- The shell tool has no `mode`.
- A host tool cannot put a row in the chat's background work.
- Nothing starts a turn when a command ends.

## Answers

| What | Source | Task |
| --- | --- | --- |
| ahpd builds `mode=async`, which the description promises | Softov, 2026-10-27 | 01 |
| An async command is a background row with its terminal, and its end wakes the session | Softov, 2026-11-03, chose "Row and wake" | 01, 02 |
| The row's stop is `vscode/stopBackgroundWork`, which interrupts the command | (defaulted: the method and the flag exist on main) | 01 |
| The end starts its turn as a wake does, and does not set the chat's wake | (defaulted: `setWake` holds one wake, which the model may have set) | 02 |
| The woken turn says the command, its exit code and the last 60 KB of its output | (defaulted: the cap of the agent terminal tool) | 02 |
| A turn that runs when the command ends gets the message queued, as a wake does | [code://packages/sdk/src/host/wakes.ts#L84-L121](../../../../packages/sdk/src/host/wakes.ts#L84-L121) | 02 |

## Proposed architecture

- **Data flow** - the tool answers at once. The shell manager keeps the shell busy until the command ends.
- **Event flow** - `chat/backgroundWorkSet` when the command starts, `chat/backgroundWorkRemoved` when it ends, then a turn.
- **State flow** - the row and the busy shell are held until the end mark, the sentinel, the stop, or the shell's exit.
- **Layer responsibilities** - `@ahpd/sdk`: the mode, the row, the stop and the woken turn.
- **Source-of-truth files** - [`code://packages/sdk/src/host/background.ts`](../../../../packages/sdk/src/host/background.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an async command is a row](task-01-an-async-command-is-a-row.md) | implemented | - |
| [02 - an async command's end wakes the session](task-02-an-async-commands-end-wakes-the-session.md) | todo | 01 |

## Risks and tradeoffs

- A daemon restart ends the shell and its command, so the row goes and no turn starts. The terminal's kept output stays.
- `mode` is ahpd's own field on VS Code's tool. A client that knows VS Code's schema only does not send it, and the model does.

## Resume state

- **Done so far:** task 01 is implemented: `mode` on the shell tool, `Shells.start` on the per-chat manager, `ToolCall.background()` built on the chat's held tasks, the row with its terminal and stop, and `packages/sdk/test/shell-async.test.ts`.
- **Next action:** [task-02-an-async-commands-end-wakes-the-session.md](task-02-an-async-commands-end-wakes-the-session.md).
- **Open questions:** none.
- **Watch out for:** the end of a command must not call `setWake`.

## Final verification checklist

- [ ] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- [ ] `pnpm --filter @ahpd/sdk test` passes.
- [ ] On a test daemon, `sleep 5; echo done` with `mode=async` shows a row, and five seconds later a turn starts with `done`.
