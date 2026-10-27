---
title: The host says a command's terminal as it opens
domain: host
status: built
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/128-a-shell-commands-call-shows-its-terminal/plan.md
refs:
  - "[code://packages/sdk/src/host/terminals.ts#L95-L145](../../../../packages/sdk/src/host/terminals.ts#L95-L145) - `commanded`, which opens the terminal and answers only when the command exits"
  - "[code://packages/sdk/src/host/terminals.ts#L186-L255](../../../../packages/sdk/src/host/terminals.ts#L186-L255) - `heldTerminals`, the terminal a backend opens, whose handle does not say what the terminal is"
  - "[code://packages/sdk/src/types/session.ts#L337-L348](../../../../packages/sdk/src/types/session.ts#L337-L348) - `Ran`"
  - "[code://packages/sdk/src/types/session.ts#L522](../../../../packages/sdk/src/types/session.ts#L522) - `Session.ran`, whose `run` a backend calls with the call's id"
  - "[code://packages/sdk/src/types/terminals.ts#L216-L250](../../../../packages/sdk/src/types/terminals.ts#L216-L250) - `OpenedTerminal`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1381-L1387](../../../../packages/sdk/src/host/lifecycle.ts#L1381-L1387) - where the host hands a backend `run`"
  - "[code://packages/sdk/test/pty.test.ts#L21-L38](../../../../packages/sdk/test/pty.test.ts#L21-L38) - the fake pseudoterminal, which a host case needs as well"
  - "[code://docs/sdk/TERMINALS.md#L41](../../../../docs/sdk/TERMINALS.md#L41) - what a `!` command does"
  - "[code://docs/sdk/AHP.md#L272](../../../../docs/sdk/AHP.md#L272) - what this host sends `chat/toolCallContentChanged` for"
---

## Goal

The host opens a `!` command's terminal, and a backend learns its name only from `Ran`, when the command has exited.
`Ran` does not say whether the terminal is a pseudoterminal, and nor does the handle of a terminal a backend opens.
With this plan, `run` tells a backend the terminal as soon as it opens, and both say whether it is a pseudoterminal.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "ran\?\(" packages/*/src` - every backend calls `run` with the call's id, and nothing else.
- `rg -n "waitForExit:" packages/*/src packages/*/test` - the host's handle and two ACP test handles implement `OpenedTerminal`.
- The terminal's state says `isPty` from the moment it opens, and it does not change.

### Runtime path

```
lifecycle -> session.ran(turnId, command, run) -> run(toolCallId, opened)
  -> commanded -> shells.create -> opened({ uri, isPty }) -> ... -> exit -> Ran { terminal, isPty }
start.terminals.open -> OpenedTerminal { uri, isPty }
```

### Gaps

- A backend cannot name a `!` command's terminal before the command exits.
- A backend cannot say whether a terminal it names is a pseudoterminal.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `run` takes a second argument, called with the terminal's name and `isPty` as soon as the terminal opens. | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L91-L104 | 01 |
| `Ran` and `OpenedTerminal` say `isPty` as the terminal's state says it, and leave it out when the state does. | `TerminalState.isPty` and `ToolResultTerminalContent.isPty` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |
| The fake pseudoterminal is one helper that the store's suite and the host's cases share. | (defaulted: one fake, so the two suites cannot drift) | 01 |
| The docs and the changelog say that the call names its terminal as it opens, and whether it is a pseudoterminal. | [code://docs/sdk/TERMINALS.md#L41](../../../../docs/sdk/TERMINALS.md#L41) | 01 |

## Proposed architecture

- **Data flow** - the terminal's name and `isPty` reach a backend when the terminal opens, and again in `Ran`.
- **Event flow** - no change on the host's channels.
- **State flow** - no change.
- **Layer responsibilities** - `@ahpd/sdk`: the port a backend runs a command through, and the handle of a terminal it opens.
- **Source-of-truth files** - [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host says a command's terminal as it opens](task-01-the-host-says-a-commands-terminal.md) | done | - |

## Risks and tradeoffs

- `run` keeps its first argument and its answer, so a backend that passes no second argument runs as before.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a fake pseudoterminal must exit, or `commanded` never answers.

## Final verification checklist

- [x] The new case fails on the host before this change.
- [x] `plans/index.md` updated.
