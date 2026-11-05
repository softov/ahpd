---
title: An async command is a background row - implemented
date: 2026-11-04
refs:
  - git://f1b392e8
  - "[code://packages/sdk/src/tools/shell.ts](../../../../packages/sdk/src/tools/shell.ts)"
  - "[code://packages/sdk/src/host/shells.ts](../../../../packages/sdk/src/host/shells.ts)"
  - "[code://packages/sdk/src/host/wakes.ts](../../../../packages/sdk/src/host/wakes.ts)"
---

An agent starts a command with `mode=async` and gets its shell id at once. The command is a background row with its terminal and a stop button, and its end wakes the session with the end of its output.

## What was built

- [`code://packages/sdk/src/tools/shell.ts`](../../../../packages/sdk/src/tools/shell.ts) - `mode` in the schema of `bash` and `powershell`, and the async answer.
- [`code://packages/sdk/src/host/shells.ts`](../../../../packages/sdk/src/host/shells.ts) - an async command starts without a wait, keeps its shell busy, and sets and removes its row.
- [`code://packages/sdk/src/host/wakes.ts`](../../../../packages/sdk/src/host/wakes.ts) - a command's end begins a turn whose message has origin `systemNotification`.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `toolContext` gives a tool its chat's background rows.

## Verified

- `shell-async.test.ts` holds the cases.
- #213 merged with CI green.
- Softov ran the *Async commands* section of `host-1620-terminal-tool-checks.md` on 2026-11-04, and it passed.
- ahpw drew the wake turn's message as a bubble, because the ahpw he ran did not have ahpw #39 yet.

## Departures from the plan

- None.
