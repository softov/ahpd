---
title: Completions offer each slash command once - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
  - "[code://packages/sdk/test/host-harness.test.ts](../../../../packages/sdk/test/host-harness.test.ts)"
---

A slash menu shows each command once.
A session whose backend has not answered yet gets its own backend's commands, not every backend's.

## What was built

- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `completions` reads the session behind a chat or a session channel.
- The fallback list is the client's `provider`, else that session's backend, else every backend.
- Each command name is offered once, and the first one is kept.

## Verified

- In the review worktree on main `b6e61e5`: install, schema, build, typecheck and boundary pass, and the suite passes 4686 tests in 265 files.
- `host-harness.test.ts` has two new cases in `what a slash offers`, and both failed before the fix.
- One is the root channel with two Claude presets, and one is a session whose CLI has not answered.

## Departures from the plan

- none.

## Left for later

- none.
