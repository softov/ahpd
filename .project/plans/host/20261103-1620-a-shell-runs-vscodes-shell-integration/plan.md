---
title: A shell opened to sit in runs VS Code's shell integration
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
requires: []
changes:
  - specs/agent-backends.md
refs:
  - git://14beb809 - the commit of ahpd this plan was checked at
  - git://e7ada61c - MayCXC's branch `host/124-an-agents-shell-is-a-terminal-the-person-sees`; its `osc633.ts`, `shellintegration.ts`, `headlessterminal.ts` and the seven scripts are ports to take, not to merge
  - "[code://packages/sdk/src/machines/terminals.ts#L176-L181](../../../../packages/sdk/src/machines/terminals.ts#L176-L181) - `kindOf`, the one shell classifier"
  - "[code://packages/sdk/src/machines/terminals.ts#L229-L272](../../../../packages/sdk/src/machines/terminals.ts#L229-L272) - `MARKS`, `HELD` and `unfinished`: OSC 133 and OSC 7 only, with one hold-back buffer"
  - "[code://packages/sdk/src/machines/terminals.ts#L380-L417](../../../../packages/sdk/src/machines/terminals.ts#L380-L417) - the shell's argv and environment; a shell with no `command` gets no arguments"
  - "[code://packages/sdk/src/machines/terminals.ts#L440-L500](../../../../packages/sdk/src/machines/terminals.ts#L440-L500) - `meant` and `read`, which turn a mark into its action and strip it"
  - "[code://packages/sdk/src/machines/terminals.ts#L511-L558](../../../../packages/sdk/src/machines/terminals.ts#L511-L558) - a pseudoterminal when a `SpawnPty` was handed in, pipes otherwise"
  - "[code://packages/sdk/src/machines/terminals.ts#L635-L666](../../../../packages/sdk/src/machines/terminals.ts#L635-L666) - `state`, with `supportsCommandDetection` and `isPty`"
  - "[code://packages/sdk/src/machines/terminals.ts#L812-L816](../../../../packages/sdk/src/machines/terminals.ts#L812-L816) - `shellTerminals`, the store the daemon builds"
  - "[code://packages/sdk/src/types/terminals.ts#L18-L172](../../../../packages/sdk/src/types/terminals.ts#L18-L172) - `TerminalOptions`, `Terminal`, `Pty` and `SpawnPty`"
  - "[code://packages/server/src/pty.ts#L192-L208](../../../../packages/server/src/pty.ts#L192-L208) - `pty()`, the binding the daemon hands the store: the pattern for each new port"
  - "[code://packages/server/src/commands/run.ts#L1121](../../../../packages/server/src/commands/run.ts#L1121) - the daemon loads the binding"
  - "[code://packages/server/src/commands/run.ts#L1204-L1207](../../../../packages/server/src/commands/run.ts#L1204-L1207) - the daemon builds the store with it"
  - "[code://packages/sdk/src/host/terminals.ts#L432-L503](../../../../packages/sdk/src/host/terminals.ts#L432-L503) - a client's `createTerminal`, today the only shell opened to sit in"
  - "[code://packages/agent-acp/src/session/handlers.ts#L373-L438](../../../../packages/agent-acp/src/session/handlers.ts#L373-L438) - a terminal in a machine runs `computers.how`'s argv, a command, so it gets no integration"
  - "[code://packages/sdk/test/pty.test.ts](../../../../packages/sdk/test/pty.test.ts) - the store's cases with a fake pseudoterminal"
  - "[code://packages/server/test/server-pty.test.ts](../../../../packages/server/test/server-pty.test.ts) - the Bun binding's cases"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L306-L432 - `createTerminal`: the environment, `preventShellHistory`, `nonInteractive`, the injection and the headless screen
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L653-L807 - `_handlePtyData` and `_handleOsc633Event`: marks in stream order, the nonce on a command line, and `onCommandFinished`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostHeadlessTerminal.ts - the headless screen, used for the alternate screen, bracketed paste and the cursor answer
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/terminal/node/terminalEnvironment.ts#L52-L277 - `getShellIntegrationInjection`, and the shells and arguments it refuses
  - https://github.com/microsoft/vscode/tree/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/workbench/contrib/terminal/common/scripts - the seven scripts, under VS Code's MIT license
  - npm://@xterm/headless@^6.0.0 - the headless screen, the stable release
---

## Goal

A shell that a person or an agent opens to sit in runs VS Code's shell integration, as VS Code's agent host does.
The shell then marks each prompt, command, exit code and directory, so a client sees each command as its own part with its output.
Today a shell marks commands only when the person's own prompt writes OSC 133.
The daemon also keeps a screen for each terminal.
A tool can then see a full-screen program and bracketed paste, and a program that asks for the cursor gets an answer.
This plan is the base of plan [the agent terminal tool](../20261103-1620-the-agent-terminal-tool/plan.md).

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "633|@xterm|isInAltBuffer|isBracketedPasteMode|\[6n" packages/*/src` - nothing on main.
- `rg -n "nonInteractive|preventShellHistory|PROMPT_EOL_MARK|VSCODE_" packages/*/src` - nothing on main.
- `rg -n "computers.how|machineIdOf" packages/*/src` - only ACP's `openTerminal` places a host terminal's process in a machine, and it runs a command.
- `git diff --stat main...maycxc/host/124-an-agents-shell-is-a-terminal-the-person-sees` - the fork puts the scripts and `@xterm/headless` in the sdk, and adds a second hold-back buffer.

### Runtime path

```
createTerminal (client) or the shell manager (plan B) -> store.create({ no command }) -> integration port -> argv and env -> pty
pty data -> screen port (alternate screen, paste mode, cursor answer) -> read: OSC 633 and OSC 133 and OSC 7 -> terminal actions -> command parts
```

### Gaps

- No shell gets VS Code's integration, so most shells mark nothing.
- The store reads OSC 133 and OSC 7, and not the OSC 633 marks VS Code's scripts write.
- No terminal has a screen, so nobody can tell a full-screen program or bracketed paste, and a cursor request gets no answer.
- `TerminalOptions` has no `nonInteractive` or `preventShellHistory`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every shell opened to sit in gets the integration, a client's included. A shell given a command is left as it is | Softov, 2026-10-27 | 02 |
| The seven scripts go in the server package beside `pty.ts`, and the daemon hands them to the store as it hands `pty` | Softov, 2026-10-27 | 02 |
| The server package depends on `@xterm/headless`, and uses it for the three things VS Code uses it for | Softov, 2026-10-27 | 03 |
| A shell in a machine gets no integration, and the store leaves room to copy or mount the scripts there later | Softov, 2026-11-03: "no integration, leave space for after copy or mount scropts" | 02 |
| `@xterm/headless` is `^6.0.0`, the stable release, and not VS Code's beta range | (defaulted: npm `latest` is 6.0.0; Aaron refused the beta on 2026-10-26 in the fork's plan) | 03 |
| The store strips OSC 633 as it strips OSC 133, with one hold-back buffer for both | (defaulted: the protocol requires a server to strip marks from `terminal/data`) | 01 |
| A command line from OSC 633 `E` counts only with the terminal's nonce | [agentHostTerminalManager.ts#L718-L724](https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L718-L724) | 01 |
| `nonInteractive` and `preventShellHistory` are `TerminalOptions`, set by agent shells, as VS Code's callers set them | [agentHostTerminalManager.ts#L332-L353](https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L332-L353) | 02 |
| `kindOf` stays the one shell classifier, and says the shell's name for the injection | (defaulted: three classifiers on the fork) | 02 |

## Proposed architecture

- **Data flow** - the store asks the integration port for argv and environment. It asks only for a shell with no command, under a pseudoterminal, not in a machine.
- **Event flow** - pseudoterminal data goes to the screen port first, then to `read`. `read` turns OSC 633, OSC 133 and OSC 7 into terminal actions in stream order.
- **State flow** - the store holds one screen for each terminal. `Terminal` answers `isInAltBuffer` and `isBracketedPasteMode` from it.
- **Layer responsibilities** - `@ahpd/sdk`: the OSC 633 parser, the port types and the store · `@ahpd/server`: the scripts, the injection and the screen.
- **Source-of-truth files** - [`code://packages/sdk/src/machines/terminals.ts`](../../../../packages/sdk/src/machines/terminals.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the store reads VS Code's marks](task-01-the-store-reads-vscodes-marks.md) | done | - |
| [02 - a shell to sit in runs the integration](task-02-a-shell-to-sit-in-runs-the-integration.md) | done | 01 |
| [03 - each terminal has a screen](task-03-each-terminal-has-a-screen.md) | done | 01 |

## Risks and tradeoffs

- A person's own prompt may also write OSC 133. VS Code's scripts write OSC 633 and keep a prompt's own marks, so the store reads both kinds without double counting a command.
- zsh's injection needs a temporary folder and a sticky bit. A failure starts the shell with no integration, as VS Code does.
- Under Bun the injection has never run. Task 02 tests it under Bun's terminal.

## Resume state

- **Done so far:** built in #209, and Softov checked it by hand on Linux on 2026-11-04. See [implemented.md](implemented.md).
- **Next action:** none. The check by hand passed on Windows on 2026-11-12, in PowerShell; macOS was not run, and the check closed on Softov's word.

## Final verification checklist

- [x] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- [x] `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass, one at a time.
- [ ] A client terminal on a test daemon shows each command as a `command` part with its exit code, under node-pty and under Bun.
- [x] `vim` in a client terminal makes `isInAltBuffer` true.
