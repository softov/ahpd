---
title: A shell command's call shows its terminal as it is, while it runs
domain: host
status: built
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/127-every-agent-sends-what-the-protocol-declares/plan.md
refs:
  - "[code://packages/sdk/src/host/terminals.ts#L95-L145](../../../../packages/sdk/src/host/terminals.ts#L95-L145) - `commanded`, which runs a `!` command and says nothing about its terminal until the command exits"
  - "[code://packages/sdk/src/types/session.ts#L337-L348](../../../../packages/sdk/src/types/session.ts#L337-L348) - `Ran`, which names the terminal and not whether it is a pseudoterminal"
  - "[code://packages/sdk/src/machines/terminals.ts#L540-L546](../../../../packages/sdk/src/machines/terminals.ts#L540-L546) - the store's state, which says `isPty` from the binding it was handed"
  - "[code://packages/agent-claude/src/session/turns.ts#L379-L400](../../../../packages/agent-claude/src/session/turns.ts#L379-L400) - a `!` call's content, named only at the end and `isPty: false` whatever the terminal is"
  - "[code://packages/sdk/test/support/replay.ts](../../../../packages/sdk/test/support/replay.ts) - the chat a watching client builds, and the calls in it"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ToolResultTerminalContent.isPty` (\"When `false`, output is plain text and clients do not need to parse VT sequences\"), and the reducer, which applies `chat/toolCallContentChanged` to a running call
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L65-L117 - the reference's `!` command, a `terminal` call whose content names its terminal as soon as the terminal opens
---

## Goal

A `!` command runs in a terminal the host opens, and its call shows that terminal.
The reference names the terminal in the call's content as soon as it opens, so a client can watch the output arrive.
Here every backend names it only when the command has ended, and says `isPty: false` even when the terminal is a pseudoterminal.
A pi call names no terminal at all, and its tool name is not the one a client draws a shell by.
With this plan, every backend's `!` call names its terminal while the command runs, and says what the terminal is.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "isPty" packages/*/src` - three backends write `isPty: false` on a `!` call, and the ACP mapping writes it on a terminal its server opened.
- `rg -n "done.terminal" packages/agent-*/src` - Claude, ACP and cofold name the terminal; pi does not.
- `rg -n "toolCallContentChanged" packages/agent-*/src/**/turns.ts packages/agent-acp/src/session/queue.ts` - no backend names a `!` call's terminal before the call completes.
- A cofold `!` call is held as `streaming`, and its ready goes to clients and not onto the held call.

### Runtime path

```
!command -> lifecycle ran -> commanded opens the terminal -> the call names it now
the command exits -> Ran -> the call completes with the terminal and the output
```

### Gaps

- A client cannot watch a `!` command's output while it runs.
- A client reads a pseudoterminal's output as plain text.
- A pi `!` call is drawn as an unknown tool, with no terminal.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The call names its terminal in its content as soon as the terminal opens, with `chat/toolCallContentChanged`. | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L96-L104 | p1 to p5 |
| The content says `isPty` as the terminal's state says it, and nothing when no state says it. | `ToolResultTerminalContent.isPty` in npm://@microsoft/agent-host-protocol@1.0.0 | p1 to p5 |
| The completed call holds the terminal first and the output after it. | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L106-L117 | p2 to p5 |
| A backend keeps its own record of the call, and puts each action's fields onto it from the same object it sends. | [code://packages/agent-claude/src/session/stream.ts#L573-L583](../../../../packages/agent-claude/src/session/stream.ts#L573-L583) | p2 to p5 |
| A `!` call is named `terminal` and shown as `Terminal`, with the command as its intention and its input. | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L67-L82 | p5 |

## Proposed architecture

- **Data flow** - the host tells a backend the terminal as it opens, and `Ran` says whether it is a pseudoterminal.
- **Event flow** - a `chat/toolCallContentChanged` with the terminal goes out between a `!` call's ready and its completion.
- **State flow** - each backend's record of a `!` call follows the reducer: ready, running with the terminal, completed.
- **Layer responsibilities** - `@ahpd/sdk`: the terminal a command runs in; each agent package: its own `!` call.
- **Source-of-truth files** - [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts)

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The host says a command's terminal as it opens](../128-p1-the-host-says-a-commands-terminal-as-it-opens/plan.md) | built 2026-10-27 | - |
| [p2 - A Claude command shows its terminal](../128-p2-a-claude-command-shows-its-terminal/plan.md) | built 2026-10-27 | p1 |
| [p3 - An ACP command and terminal say what they are](../128-p3-an-acp-command-and-terminal-say-what-they-are/plan.md) | built 2026-10-27 | p1 |
| [p4 - A cofold command shows its terminal](../128-p4-a-cofold-command-shows-its-terminal/plan.md) | built 2026-10-27 | p1 |
| [p5 - A pi command is a terminal call](../128-p5-a-pi-command-is-a-terminal-call/plan.md) | built 2026-10-27 | p1 |

## Risks and tradeoffs

- A backend that runs no host terminal, and a run that names none, send no early content; the call completes as before.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `chat/toolCallContentChanged` replaces the call's `_meta` when it carries one, so the early content carries none.

## Final verification checklist

- [x] Each case fails on the code before this plan.
- [x] `pnpm boundary`, `pnpm typecheck` and `pnpm build` pass, and so do the suites of the packages this plan changes.
- [x] `plans/index.md` updated.
