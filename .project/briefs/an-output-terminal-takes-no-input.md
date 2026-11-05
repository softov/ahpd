---
title: An output terminal takes no input
created: 2026-11-04
refs:
  - git://e8d5aae0 - the commit of this repository the facts were checked at
  - "[code://packages/sdk/src/host/terminals.ts#L362-L445](../../packages/sdk/src/host/terminals.ts#L362-L445) - `heldOutputs`, the output terminal: no process, a session's claim, and a `write` that drops input"
  - "[code://packages/sdk/src/host/actions.ts#L1012-L1016](../../packages/sdk/src/host/actions.ts#L1012-L1016) - the host takes any claim that names a client or a session, on every terminal"
  - "[code://packages/agent-claude/src/session/savedoutput.ts#L117-L136](../../packages/agent-claude/src/session/savedoutput.ts#L117-L136) - Claude's Bash output shows in an output terminal with `isPty: false`"
  - "[code://packages/sdk/src/tools/shell.ts#L29](../../packages/sdk/src/tools/shell.ts#L29) - `enableCustomTerminalTool`, which gives Claude the host's shell, a real terminal a person can type into"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L188-L199 - VS Code's output terminal, which the host follows
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L517-L632 - VS Code takes a claim on an output terminal and drops its input
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-terminal/state.ts - `TerminalState`, which has `isPty` and no read-only flag
---

# An output terminal takes no input

Softov wants to know why "Take over" on the terminal of Claude's background Bash lets him type, and nothing happens.
He saw it on 2026-11-04 in ahpw, with `sleep 600` and a `date` loop run by Claude's own Bash tool.
He asks if this is by design, and if the host's shell is the terminal to type into.

## What others do

- VS Code's host serves Claude's Bash output as an output terminal: no pty, plain text, `isPty: false`.
- It takes a `terminal/claimed` on an output terminal and stores the claim.
- It writes `terminal/input` only to a terminal with a pty, so the input to an output terminal goes nowhere.
- The protocol's `TerminalState` has `isPty` and `claim`, and no field that says a terminal takes no input.
- How VS Code's chat view draws an output terminal, and if it offers to take it over, was not checked.

## What ahpd has today

- The host does what VS Code does: an output terminal takes a claim, and its `write` drops the input.
- The terminal holds a text file the CLI writes, and Claude's background Bash reads no input, so there is nothing to send input to.
- ahpw shows "Take over" on every running terminal that a session holds.
- After a take over, ahpw lets the person type, and echoes the keys itself because `isPty` is `false`. The host drops them.
- With `enableCustomTerminalTool` on, Claude's shell calls go to the host's shell. That is a real terminal, and a person who takes it over types into the running shell.

## Who writes

- No open branch changes `terminals.ts` or `actions.ts`.
- ahpw branch `terminals/plain-text-ends-its-lines` changes `TerminalPage.tsx` so plain text starts each line at the left margin. It does not change take over.

## The change

- If the host keeps to the reference, nothing changes there. An output terminal shows output, and a person types into the host's shell.
- A client cannot tell an output terminal from a shell without a pty, because both have `isPty: false`. So a client that hides "Take over" needs a signal from the host.

## Open points

- If the host keeps the reference's behaviour, or refuses a claim on an output terminal.
- If a signal is needed, which one: a refusal, a field in `TerminalState` (a protocol change), or something VS Code's client already reads.
- How VS Code's chat view draws an output terminal.
