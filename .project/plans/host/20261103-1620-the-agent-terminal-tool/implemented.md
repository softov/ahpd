---
title: The agent terminal tool - implemented
date: 2026-11-04
refs:
  - git://f11dc0a2
  - "[code://packages/sdk/src/host/shells.ts](../../../../packages/sdk/src/host/shells.ts)"
  - "[code://packages/sdk/src/host/shellcommand.ts](../../../../packages/sdk/src/host/shellcommand.ts)"
---

An agent runs its shell commands in terminals the session holds, behind the root config key `enableCustomTerminalTool`. The person can watch a command, type into it and stop it.

## What was built

- [`code://packages/sdk/src/host/shells.ts`](../../../../packages/sdk/src/host/shells.ts) - the shell manager.
- [`code://packages/sdk/src/host/shellcommand.ts`](../../../../packages/sdk/src/host/shellcommand.ts) - one command's run, its endings and its output.

## Verified

- #211 merged with CI green, on Linux and Windows.
- Softov ran the *The agent terminal tool* section of `host-1620-terminal-tool-checks.md` on Linux on 2026-11-04, and it passed.

## Departures from the plan

- None.

## Left for later

- The same check does not apply on Windows, where the host never offers the tool, as VS Code does not. macOS was not run, and the check closed on 2026-11-12 on Softov's word.
