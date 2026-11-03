---
title: The store reads VS Code's marks
status: todo
depends: []
layer: "@ahpd/sdk machines"
refs:
  - "[code://packages/sdk/src/machines/terminals.ts#L229-L272](../../../../packages/sdk/src/machines/terminals.ts#L229-L272) - the marks the store reads today, and its one hold-back buffer"
  - "[code://packages/sdk/src/machines/terminals.ts#L440-L500](../../../../packages/sdk/src/machines/terminals.ts#L440-L500) - `meant` and `read`"
  - git://e7ada61c - `packages/sdk/src/machines/osc633.ts`, a port of VS Code's `Osc633Parser`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/osc633Parser.ts - the parser
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L653-L807 - what each OSC 633 event does to the terminal
---

## Objective

The store reads OSC 633 marks as well as OSC 133 and OSC 7.
It strips them all from `terminal/data`, and sends each action where its mark stood.
A command line from OSC 633 `E` counts only when it carries the terminal's nonce.

## Files

- `CREATE: packages/sdk/src/machines/osc633.ts` - the OSC 633 parser, taken from the fork and fitted to `read`, with no buffer of its own.
- `UPDATE: packages/sdk/src/machines/terminals.ts:229-272` - one pattern and one hold-back buffer for OSC 633, OSC 133 and OSC 7.
- `UPDATE: packages/sdk/src/machines/terminals.ts:440-500` - `meant` handles the OSC 633 events: `A`, `B`, `C`, `D`, `E` with the nonce, and `P;Cwd=`.
- `UPDATE: packages/sdk/src/types/terminals.ts:18-68` - `TerminalOptions.nonce`, the value the integration gives the shell.
- `UPDATE: packages/sdk/test/pty.test.ts` - cases for OSC 633 marks.

## Steps

1. Copy `osc633.ts` from `e7ada61c` and keep its VS Code citation.
2. Remove the parser's own hold-back, so `unfinished` in `terminals.ts` is the only buffer.
3. Extend `MARKS` to match OSC 633 beside OSC 133 and OSC 7.
4. Map each OSC 633 event in `meant` to the action its OSC 133 twin sends today.
5. Take the command line from `E` only when its nonce equals `options.nonce`, else keep the typed line.
6. Send `terminal/cwdChanged` for `P;Cwd=`, as OSC 7 does.
7. Add the cases to `pty.test.ts`.

## Validation

- `pty.test.ts`: a command marked with OSC 633 becomes one `command` part with its output and exit code.
- `pty.test.ts`: OSC 633 bytes never reach `terminal/data`, also when a mark is split across two chunks.
- `pty.test.ts`: an `E` with a wrong nonce does not set the command line.
- `pty.test.ts`: OSC 133 cases still pass unchanged.
- `pnpm --filter @ahpd/sdk test` passes.

## Resume
