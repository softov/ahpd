---
title: Each terminal has a screen
status: done
depends:
  - task-01-the-store-reads-vscodes-marks.md
layer: "@ahpd/sdk machines, @ahpd/server"
refs:
  - "[code://packages/sdk/src/types/terminals.ts#L71-L139](../../../../packages/sdk/src/types/terminals.ts#L71-L139) - `Terminal`, which gains the two reads"
  - "[code://packages/sdk/src/machines/terminals.ts#L511-L558](../../../../packages/sdk/src/machines/terminals.ts#L511-L558) - where pseudoterminal data comes in"
  - git://e7ada61c - `packages/sdk/src/host/headlessterminal.ts`, the fork's wrapper of `@xterm/headless`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostHeadlessTerminal.ts - the screen, and the cursor answers it forwards
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L427-L475 - the screen is fed before the marks are read, and its answers go back to the program
  - npm://@xterm/headless@^6.0.0 - the headless screen
---

## Objective

Each terminal under a pseudoterminal has a headless screen that the daemon feeds with the program's output.
`Terminal` says whether the program is on the alternate screen and whether it turned on bracketed paste.
A program that asks for the cursor position gets the screen's answer.

## Files

- `CREATE: packages/server/src/screen.ts` - the `@xterm/headless` screen, from the fork's `headlessterminal.ts`, as a port.
- `UPDATE: packages/server/package.json` - `@xterm/headless` `^6.0.0` in `dependencies`.
- `UPDATE: packages/sdk/src/types/terminals.ts:71-139` - `isInAltBuffer()`, `isBracketedPasteMode()` and `whenAltBuffer()` on `Terminal`, and the `Screen` port type.
- `UPDATE: packages/sdk/src/machines/terminals.ts:511-558` - feed the screen before `read`, and write its cursor answers to the pseudoterminal.
- `UPDATE: packages/sdk/src/machines/terminals.ts:812-816` - `shellTerminals` takes the screen port.
- `UPDATE: packages/server/src/commands/run.ts:1204-1207` - the daemon hands the screen port to the store.
- `UPDATE: packages/sdk/test/pty.test.ts` - cases with a fake screen.
- `CREATE: packages/server/test/screen.test.ts` - the real screen.

## Steps

1. Write `screen.ts` from the fork's wrapper, with VS Code's cursor answer filter.
2. Declare the `Screen` port in `types/terminals.ts`.
3. Feed the screen with each pseudoterminal chunk before `read` handles it.
4. Write each answer the screen gives back to the pseudoterminal.
5. Answer `isInAltBuffer` and `isBracketedPasteMode` from the screen, and `false` with no screen.
6. Resize the screen with the terminal.
7. Dispose of the screen when the terminal exits.
8. Hand the port to the store in `run.ts`.
9. Write the tests.

## Validation

- `screen.test.ts`: `ESC[?1049h` makes `isInAltBuffer` true, and `ESC[?1049l` makes it false.
- `screen.test.ts`: `ESC[?2004h` makes `isBracketedPasteMode` true.
- `screen.test.ts`: the screen answers `ESC[6n` with the cursor, and answers nothing else.
- `pty.test.ts`: a terminal on pipes, and a store with no screen port, answer `false` for both reads.
- `pnpm boundary` passes with `@xterm/headless` in the server package only.
- `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass, one at a time.

## Resume

Implemented 2026-11-03.
`packages/server/src/screen.ts` is the fork's `headlessterminal.ts` as a `SpawnScreen` port over `@xterm/headless`, with VS Code's cursor-answer filter on the emulator's data channel so only a cursor position report reaches the program, and `whenAltBuffer` flushing what was fed before it listens.
`packages/server/package.json` declares `@xterm/headless` `^6.0.0`, and `run.ts` hands the port to the store.
`packages/sdk/src/types/terminals.ts` declares `Screen`, `ScreenOptions` and `SpawnScreen`, and `Terminal` gains `isInAltBuffer`, `isBracketedPasteMode` and `whenAltBuffer`; the host's own output terminal in `host/terminals.ts` answers `false` and resolves, since no process wrote it.
`machines/terminals.ts` makes one screen per pseudoterminal, feeds it each chunk before `read`, writes its answers to the pty, resizes and disposes it with the terminal, and answers `false` without one.
`packages/server/test/screen.test.ts` covers the alternate buffer, bracketed paste, the cursor answer and the alt-buffer wait; `pty.test.ts` covers the store's side with a fake screen, including pipes and a store with no port.
`docs/sdk/TERMINALS.md` describes the screen and what a caller reads from it.
Gates: `pnpm build`, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm boundary`, the sdk suite and the server suite all pass.
