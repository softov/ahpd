---
title: A demo host shows every subject - implemented
date: 2026-11-04
refs:
  - git://c1b9b792 - the main this was built on
  - "[code://examples/demo/agent.ts](../../../../examples/demo/agent.ts)"
  - "[code://examples/demo/main.ts](../../../../examples/demo/main.ts)"
  - "[code://packages/sdk/test/demo.test.ts](../../../../packages/sdk/test/demo.test.ts)"
---

`pnpm demo -- --port <n> --path <dir>` starts a host that a client can draw every screen from, with no model behind it.
Its agent, `demo`, is the `notes` agent with three models and two customizations.
It adds a `slow` turn that runs for a minute, and a `fail` turn that ends in an error.
The host holds automations in memory.

## What was built

- [`code://examples/demo/agent.ts`](../../../../examples/demo/agent.ts) - `demo(options)`, which wraps `notes`: its `probe`, its provider name, and each session's `begin`, `cancel`, `status`, `models` and states.
- [`code://examples/demo/main.ts`](../../../../examples/demo/main.ts) - the host: `notes/main.ts` with `demo` and `memoryAutomations()`, on port 9210 and folder `./demo` by default.
- [`code://examples/demo/README.md`](../../../../examples/demo/README.md) - what the demo serves and how to start it.
- [`code://package.json`](../../../../package.json) - `demo` and `demo:bun`.
- [`code://docs/sdk/AGENT.md`](../../../../docs/sdk/AGENT.md) - *The examples* lists the demo as the third.

## Verified

- `packages/sdk/test/demo.test.ts` has eight cases, for the root agent's models, the session's provider and customizations, and a created automation.
- The same file covers a `slow` turn that runs and ends, a cancelled `slow` turn, and a `fail` turn.
- It also covers the title of a session that starts with `fail`, and `read` asking which note.
- `pnpm typecheck` passed, and `pnpm test` passed 8587 tests in 518 files.
- `pnpm demo` on a scratch port answered `ahpc agents` with `demo  Demo  3 model(s)`, and `ahpc session list` with `No sessions.`

## Departures from the plan

- Task 02 - the wrap also replaces `status`, `activity`, `sessionState` and `chatState`, because the `notes` session cannot see a `slow` or `fail` turn.
- Task 02 - a finished `slow` or `fail` turn is pushed onto the `notes` session's `allTurns()`, so the chat keeps it in its history.
- Task 02 - `DemoOptions.every` sets the time between the `slow` lines, so the test runs in milliseconds.
- Task 01 - each session's `models()` answers the demo models, because a `notes` session answers none.
