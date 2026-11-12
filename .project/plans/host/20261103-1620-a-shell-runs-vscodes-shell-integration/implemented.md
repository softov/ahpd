---
title: A shell opened to sit in runs VS Code's shell integration - implemented
date: 2026-11-04
refs:
  - git://d428cac8
  - "[code://packages/server/src/screen.ts](../../../../packages/server/src/screen.ts)"
  - "[code://packages/sdk/src/machines/terminals.ts](../../../../packages/sdk/src/machines/terminals.ts)"
---

A shell that a person or an agent opens runs VS Code's shell integration. A client sees each command as its own part, with its exit code, and a full-screen program fills the client's terminal.

## What was built

- [`code://packages/server/src/screen.ts`](../../../../packages/server/src/screen.ts) - the `@xterm/headless` screen behind each terminal.
- [`code://packages/sdk/src/machines/terminals.ts`](../../../../packages/sdk/src/machines/terminals.ts) - feeds the screen and answers its cursor queries.

## Verified

- #209 merged with CI green, on Linux and Windows.
- Softov ran the *Shell integration* section of `host-1620-terminal-tool-checks.md` on Linux on 2026-11-04, and it passed.

## Departures from the plan

- None.

## Left for later

- The same check passed on Windows on 2026-11-12, in PowerShell. macOS was not run, and the check closed on 2026-11-12 on Softov's word.
