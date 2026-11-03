---
title: An agent's shells run its commands
status: todo
depends:
  - task-01-a-host-tool-knows-its-call.md
layer: "@ahpd/sdk host"
refs:
  - "[code://packages/sdk/src/host/terminals.ts#L109-L282](../../../../packages/sdk/src/host/terminals.ts#L109-L282) - `commanded` and `heldTerminals`, each with its own copy of the open block"
  - "[code://packages/agent-acp/src/session/handlers.ts#L373-L438](../../../../packages/agent-acp/src/session/handlers.ts#L373-L438) - a terminal in a machine through `computers.how`, the pattern for a session in a machine"
  - git://e7ada61c - the fork's `host/shells.ts` and `types/shells.ts`, to split as *Objective* says
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L55-L302 - `ShellManager`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts - `executeShellCommand`
---

## Objective

A session has a shell manager, as in VS Code's `ShellManager`.
It reuses an idle shell, skips a busy one, drops an exited one, and opens a new one.
A shell opens to sit in, with `nonInteractive`, `preventShellHistory` and the call's claim, through the one open block that `heldTerminals` also uses.
Command execution writes a command to a shell and ends on completed, timeout, background, alternate screen or shell exit.
It reads a marked command's output from its `command` part, and uses VS Code's sentinel in a shell with no marks.

## Files

- `CREATE: packages/sdk/src/host/shells.ts` - the shell manager, and nothing else.
- `CREATE: packages/sdk/src/host/shellcommand.ts` - the command execution: the sentinel, the five endings, and the output cut to 60 KB.
- `CREATE: packages/sdk/src/types/shells.ts` - `Shells`, `ShellCommandResult` and the shell kinds, from the fork.
- `UPDATE: packages/sdk/src/host/terminals.ts:109-282` - one open block, which `commanded`, `heldTerminals` and the shell manager call.
- `CREATE: packages/sdk/test/shell-manager.test.ts` - the manager and the execution, with the fake pty and screen.

## Steps

1. Move the repeated open block in `terminals.ts` into one function, and call it from `commanded` and `heldTerminals`.
2. Write the shell manager in `shells.ts`, from VS Code's `ShellManager`, with the one open block.
3. Claim each shell for its session, its chat, its turn and its call.
4. Call `opened` with the terminal when the manager gives a shell to a call.
5. For a session in a machine, open the shell with `computers.how`'s argv and `machine` set.
6. Write the execution in `shellcommand.ts`, from VS Code's `executeShellCommand`.
7. End a marked command at its `D` mark, and read the output from its `command` part.
8. End an unmarked command at the sentinel.
9. End on the alternate screen with `Terminal.whenAltBuffer`, and keep the shell busy.
10. Send a command of many lines as one paste when the shell turned on bracketed paste.
11. Cut the output for the model to the last 60 KB, without escape codes.
12. Write the tests.

## Validation

- `shell-manager.test.ts`: two calls in turn reuse one idle shell; two at once get two shells.
- `shell-manager.test.ts`: the manager drops an exited shell, and the next call opens a new one.
- `shell-manager.test.ts`: a marked command returns its `command` part's output and exit code.
- `shell-manager.test.ts`: an unmarked command ends at the sentinel, and the sentinel is not in the output.
- `shell-manager.test.ts`: a timeout returns the output so far; `vim` ends as alternate screen.
- `shell-manager.test.ts`: output over 60 KB keeps its last 60 KB.
- `shell-manager.test.ts`: a session in a machine opens its shell through `computers.how`.
- `host-terminals.test.ts` and `host-retained-terminals.test.ts` pass unchanged.

## Resume
