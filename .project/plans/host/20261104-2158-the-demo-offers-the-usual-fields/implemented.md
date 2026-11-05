---
title: The demo host offers the fields a real host offers a new session - implemented
date: 2026-11-04
refs:
  - git://eaa03c3f - the main this was built on
  - "[code://examples/demo/agent.ts](../../../../examples/demo/agent.ts) - the name and `mode`"
  - "[code://examples/demo/main.ts](../../../../examples/demo/main.ts) - `worktrees: gitWorktrees()`"
  - "[code://packages/sdk/test/demo.test.ts](../../../../packages/sdk/test/demo.test.ts) - the name and the mode cases"
---

The demo agent is `Agent Demo`, and a new session on the demo host offers `Agent Mode`, `Ask before`, `Tone`, and in a git folder `Isolation` and `Branch`.

## What was built

- [`code://examples/demo/agent.ts`](../../../../examples/demo/agent.ts) - `displayName` is `Agent Demo`. The schema gains VS Code's `mode`, and the session keeps its value, because `notes` refuses a key it does not have.
- [`code://examples/demo/main.ts`](../../../../examples/demo/main.ts) - `worktrees: gitWorktrees()`.
- [`code://examples/demo/README.md`](../../../../examples/demo/README.md) - rows for the agent and for worktrees.
- [`code://packages/sdk/test/demo.test.ts`](../../../../packages/sdk/test/demo.test.ts) - the name is `Agent Demo`, and a session has `mode`, `ask` and `tone` with `mode` at `interactive`.

## Verified

- `pnpm typecheck` and `pnpm boundary` passed. `packages/sdk/test/demo.test.ts` passed 9 tests.
- ahpc's `compose.svg`, drawn from this branch on a git folder, shows `Agent Demo`, `default`, `Interactive`, `Writes`, `plain`, `notes-app`, `Folder` and `main`.

## Departures from the plan

- Task 01 - the demo answers `setConfig` for `mode` itself, and passes every other key to `notes`.
