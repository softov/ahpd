---
title: The host says a command's terminal as it opens - implemented
date: 2026-10-27
refs:
  - git://856fd305
  - "[code://packages/sdk/src/host/terminals.ts](../../../../packages/sdk/src/host/terminals.ts)"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
---

`run` tells a backend a `!` command's terminal as soon as it opens, with its name and whether a pseudoterminal runs it.
`Ran` and the handle of a terminal a backend opens say `isPty` as the terminal's state does.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `CommandTerminal`, `RunCommand`, and `isPty` on `Ran`.
- [`code://packages/sdk/src/types/terminals.ts`](../../../../packages/sdk/src/types/terminals.ts) - `isPty` on `OpenedTerminal`.
- [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts) - `commanded` calls `opened` once the terminal is a channel, and `ptyOf` reads the state.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - the host's `run` hands the callback through.
- [`code://packages/sdk/test/support/pty.ts`](../../../../packages/sdk/test/support/pty.ts) - the fake pseudoterminal, which the store's suite and every case through a host share.
- [`code://packages/sdk/test/host-terminals.test.ts`](../../../../packages/sdk/test/host-terminals.test.ts) - the terminal a command runs in, and the handle of a terminal a backend opens.
- The docs and the changelog say what the call shows.

## Verified

- The three cases fail on the host before this change with an assertion, and pass after it.
- The store's suite passes on the shared fake, 27 of 27.

## Departures from the plan

- `RunCommand` names the type of `run`, which every backend spelt out before.

## Left for later

- none.
