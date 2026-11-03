---
title: A shell to sit in runs the integration
status: implemented
depends:
  - task-01-the-store-reads-vscodes-marks.md
layer: "@ahpd/sdk machines, @ahpd/server"
refs:
  - "[code://packages/sdk/src/machines/terminals.ts#L176-L181](../../../../packages/sdk/src/machines/terminals.ts#L176-L181) - `kindOf`"
  - "[code://packages/sdk/src/machines/terminals.ts#L380-L417](../../../../packages/sdk/src/machines/terminals.ts#L380-L417) - the argv and environment the store builds"
  - "[code://packages/sdk/src/machines/terminals.ts#L812-L816](../../../../packages/sdk/src/machines/terminals.ts#L812-L816) - `shellTerminals`, which takes the daemon's ports"
  - "[code://packages/server/src/pty.ts#L192-L208](../../../../packages/server/src/pty.ts#L192-L208) - the pattern for a port the daemon hands the store"
  - "[code://packages/server/src/commands/run.ts#L1204-L1207](../../../../packages/server/src/commands/run.ts#L1204-L1207) - where the store is built"
  - git://e7ada61c - `packages/sdk/src/machines/shellintegration.ts` and `packages/sdk/shellintegration/`, the injection and the scripts
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/terminal/node/terminalEnvironment.ts#L52-L277 - `getShellIntegrationInjection`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L322-L409 - the environment, `--login` on macOS, and the injection
---

## Objective

A shell opened with no command, under a pseudoterminal and not in a machine, starts with VS Code's shell integration.
A shell given a command, a shell on pipes, a shell in a machine, and a shell the injection refuses start as they do today.
`nonInteractive` and `preventShellHistory` set the environment VS Code sets for them.

## Files

- `CREATE: packages/server/shellintegration/` - the seven scripts from VS Code, unchanged, with the license note.
- `CREATE: packages/server/src/shellintegration.ts` - the injection, taken from the fork, which finds the scripts beside it.
- `UPDATE: packages/server/package.json` - `shellintegration` in `files`.
- `UPDATE: packages/sdk/src/types/terminals.ts:18-68` - `nonInteractive`, `preventShellHistory` and `machine` on `TerminalOptions`, and the `ShellIntegration` port type.
- `UPDATE: packages/sdk/src/machines/terminals.ts:176-181` - `kindOf` says the shell's name as well as its kind.
- `UPDATE: packages/sdk/src/machines/terminals.ts:380-417` - the store asks the port for argv and environment, and sets the two options' variables.
- `UPDATE: packages/sdk/src/machines/terminals.ts:812-816` - `shellTerminals` takes the port.
- `UPDATE: packages/server/src/commands/run.ts:1204-1207` - the daemon hands the port to the store.
- `UPDATE: packages/sdk/test/pty.test.ts` - cases with a fake port.
- `CREATE: packages/server/test/shellintegration.test.ts` - the injection for each shell, and a real bash under node-pty and under Bun.
- `UPDATE: docs/sdk/TERMINALS.md` - what a shell to sit in runs, and where.

## Steps

1. Copy the seven scripts from `e7ada61c` into `packages/server/shellintegration/`.
2. Copy `shellintegration.ts` into `packages/server/src/`, and resolve the scripts from its own folder.
3. Declare a `ShellIntegration` port in `types/terminals.ts` that takes the shell, its args, its environment and a nonce.
4. Make the port answer argv, an environment mixin and files to copy, or nothing.
5. Call the port only for a shell with no command, under a pseudoterminal, with no `options.machine`.
6. Pass `options.machine` to the port, so a later runtime can copy or mount the scripts and answer.
7. Start the shell as before when the port answers nothing or throws.
8. Set `VSCODE_PREVENT_SHELL_HISTORY=1` for `preventShellHistory`.
9. Set VS Code's non-interactive variables for `nonInteractive`.
10. Set an empty `PROMPT_EOL_MARK` for a zsh with `nonInteractive`.
11. Give the store a nonce for each terminal, and pass it to the port and to `read`.
12. Hand the port to `shellTerminals` in `run.ts`, beside the pty binding.
13. Write the tests, and the paragraph in `TERMINALS.md`.

## Validation

- `pty.test.ts`: a shell with no command under the fake pty gets the port's argv and environment.
- `pty.test.ts`: a shell with a command, on pipes, or with `machine` set never calls the port.
- `pty.test.ts`: a port that throws leaves the shell starting as today.
- `shellintegration.test.ts`: bash, zsh, fish and pwsh get VS Code's argv; `sh` and `cmd` get nothing.
- `shellintegration.test.ts`: a real bash under node-pty sends `terminal/commandFinished` with exit code 3 for `exit 3` in a subshell.
- `shellintegration.test.ts`: the same under Bun's terminal, skipped when Bun is not the runtime.
- `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass, one at a time.

## Resume

Implemented 2026-11-03.
`packages/server/shellintegration/` holds the seven scripts from `e7ada61c`, byte for byte, and `packages/server/package.json` ships the folder in `files`.
`packages/server/src/shellintegration.ts` is the fork's `getShellIntegrationInjection` with the scripts resolved beside the source, plus the `shellIntegration` port that answers `newArgs` and `envMixin` and copies zsh's four startup files itself, then `run.ts` hands it to `shellTerminals`.
The port answers no `filesToCopy`: the store has no filesystem, so the on-disk half of the injection stayed in the server and only the two values a caller applies cross the seam.
`packages/sdk/src/types/terminals.ts` declares `ShellIntegration` and `ShellIntegrationAnswer`, `TerminalOptions` gains `nonInteractive`, `preventShellHistory` and `machine`, and `machines/terminals.ts` gives `kindOf` the shell's name, generates the nonce before the port is asked, sets the two options' variables, and asks the port only for a command-less shell under a pseudoterminal with no `machine`.
`docs/sdk/TERMINALS.md` describes the port, when it is asked and the variables.
`packages/server/test/shellintegration.test.ts` exercises the injection for each shell and a real bash under node-pty.
One finding the plan did not have: the script writes an exit code only for a command it can name, so a bare `(exit 3)` gets `633;D` with no code and the test runs `bash -c "exit 3"` instead.
Gates: `pnpm build`, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm boundary`, the sdk suite and the server suite all pass.
