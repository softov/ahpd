---
title: Input to an exited shell is echoed
domain: host
status: planned
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/terminal-channel.md#L110-L112 - `terminal/input` is side-effect only, and the server forwards it to the pty"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-terminal/reducer.ts#L31-L34 - the reducer changes nothing on input"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2750-L2752 - a client's terminal action is applied and said"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3079-L3091 - its envelope goes out with the client's origin, and no terminal is looked up for it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L222-L232 - the terminal manager acts on the envelope once it is said"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L520-L527 - input is written only to a process terminal that is running"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L863-L874 - an output terminal is kept apart from the process terminals that `writeInput` reads"
  - "[code://packages/sdk/src/host/actions.ts#L877-L892](../../../../packages/sdk/src/host/actions.ts#L877-L892) - input that reaches no process is refused"
  - "[code://packages/sdk/src/machines/terminals.ts#L669-L729](../../../../packages/sdk/src/machines/terminals.ts#L669-L729) - a shell's `write` says why input did not reach a process"
  - "[code://packages/sdk/src/host/terminals.ts#L338-L340](../../../../packages/sdk/src/host/terminals.ts#L338-L340) - an output terminal's `write` says it has no process"
  - "[code://packages/sdk/src/types/terminals.ts#L106-L111](../../../../packages/sdk/src/types/terminals.ts#L106-L111) - `write` answers `true` or a sentence"
---

## Goal

Input a client sends to a terminal this host holds is answered as VS Code's host answers it.
It is echoed whatever the process's state, and it reaches the process only while one runs.
Input to a shell that has exited, or to a command's output terminal, is echoed and written nowhere.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "no process to send input" packages` - the three sentences a shell's `write` returns, and the output terminal's one.
- `rg -n "terminal/input" packages/sdk/test docs` - `host-output-terminals` asserts the refusal, and AHP.md's row names it.
- `rg -n "\.write\(" packages/sdk/src/host` - `actions.ts` is the only reader of what `write` returns.
- VS Code main at `a4e689ae` says a client's terminal action before the terminal manager reads it.
- That host writes input only to a running process terminal, and never refuses a terminal action for the terminal's state.

### Runtime path

```
dispatchAction terminal/input -> actions.ts -> terminal.write
  -> a running process: written, echoed to the sender
  -> an exited shell, or an output terminal: refused
```

### Gaps

- Input to an exited shell or an output terminal is refused, where VS Code's host says it and writes nothing.
- The protocol says nothing of input to a terminal with no process, so VS Code's host is the reference.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Input on a terminal this host holds is echoed whatever its process's state | [agentHostStateManager.ts#L3079-L3091](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3079-L3091); [agentHostTerminalManager.ts#L222-L232](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L222-L232) | 01 |
| Input reaches the process only while one runs; an exited shell's input is written nowhere | [agentHostTerminalManager.ts#L520-L527](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L520-L527) | 01 |
| An output terminal's input is echoed and written nowhere | [agentHostTerminalManager.ts#L863-L874](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L863-L874); [agentHostTerminalManager.ts#L520-L527](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L520-L527) | 01 |
| The echo goes to the sender alone, as accepted input does | [code://packages/sdk/src/host/actions.ts#L877-L892](../../../../packages/sdk/src/host/actions.ts#L877-L892) | 01 |

## Proposed architecture

- **Event flow** - `terminal/input` is echoed, and `write` sends it on while a process runs.
- **Layer responsibilities** - `actions.ts` answers the client; a terminal's `write` decides whether a process takes the input.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/machines/terminals.ts`](../../../../packages/sdk/src/machines/terminals.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Input is echoed whatever the process's state](task-01-input-is-echoed-whatever-the-process-state.md) | done | - |

## Risks and tradeoffs

- A client typing into an exited shell reads no sentence saying the input went nowhere; the terminal's exited state says it.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** the implemented record.
- **Open questions:** none.
- **Watch out for:** a shell's `exitCode` is set at `exit`, before `terminal/exited` is said at `close`; input in between goes nowhere too.

## Final verification checklist

- [ ] Each new or changed case fails on `89ebe4d5` for the reason it names, and passes after the change.
- [ ] The touched test files pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
