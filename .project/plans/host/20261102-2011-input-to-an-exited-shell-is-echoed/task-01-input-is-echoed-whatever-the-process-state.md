---
title: Input is echoed whatever the process's state
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/actions.ts#L877-L892](../../../../packages/sdk/src/host/actions.ts#L877-L892) - `terminal/input`"
  - "[code://packages/sdk/src/machines/terminals.ts#L669-L729](../../../../packages/sdk/src/machines/terminals.ts#L669-L729) - a shell's `write`"
  - "[code://packages/sdk/src/host/terminals.ts#L338-L340](../../../../packages/sdk/src/host/terminals.ts#L338-L340) - an output terminal's `write`"
---

## Objective

Input on a terminal this host holds is echoed to its sender whatever the process's state.
It reaches the process only while one runs, as VS Code's host writes it.

## Files

- `UPDATE: packages/sdk/src/types/terminals.ts:106-111` - `write` takes input and answers nothing.
- `UPDATE: packages/sdk/src/machines/terminals.ts:669-729` - a shell's `write` sends input on while a process runs.
- `UPDATE: packages/sdk/src/host/terminals.ts:338-340` - an output terminal's `write` sends input nowhere.
- `UPDATE: packages/sdk/src/host/actions.ts:877-892` - `terminal/input` is written and echoed.
- `UPDATE: packages/sdk/test/host-terminals.test.ts` - input after the shell has gone is echoed.
- `UPDATE: packages/sdk/test/host-output-terminals.test.ts` - an output terminal's input is echoed.
- `UPDATE: docs/sdk/AHP.md` - the `terminal/input` row.

## Steps

1. Make `write` answer nothing, and drop input it has no process to send to.
2. Echo `terminal/input` after the write, whatever the terminal's state.
3. Change the exited shell's case and the output terminal's case to the echo.
4. Change the `terminal/input` row of AHP.md.

## Validation

- `packages/sdk/test/host-terminals.test.ts` and `packages/sdk/test/host-output-terminals.test.ts`: the two cases fail on `89ebe4d5` and pass after.
- The terminal test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- The exited shell's case was a refusal case already, and asserts the echo with no reason.
- On `89ebe4d5`'s sources both cases fail: each input is refused, the shell's as "has exited, and has no process to send input to".
- The other files that send `terminal/input` pass: the gate, conformance, changes and retained terminal files.
