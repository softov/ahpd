---
title: Input to an exited shell is echoed - implemented
date: 2026-11-02
refs:
  - git://ed363a4f - the change
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/machines/terminals.ts](../../../../packages/sdk/src/machines/terminals.ts)"
---

Input on a terminal this host holds is echoed to its sender whatever the process's state.
It reaches the process only while one runs.
Input to a shell that has exited, or to a command's output terminal, is echoed and goes nowhere.

## What was built

- [`code://packages/sdk/src/types/terminals.ts`](../../../../packages/sdk/src/types/terminals.ts) - `write` answers nothing.
- [`code://packages/sdk/src/machines/terminals.ts`](../../../../packages/sdk/src/machines/terminals.ts) - a shell's `write` sends input on while a process runs.
- [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts) - an output terminal's `write` sends input nowhere.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - `terminal/input` is written and echoed.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `terminal/input` row.

## Verified

- The exited shell's case and the output terminal's case fail on `89ebe4d5`'s sources, each input refused, and pass with the change.
- The terminal, gate, conformance, changes and retained terminal test files pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Nothing.
