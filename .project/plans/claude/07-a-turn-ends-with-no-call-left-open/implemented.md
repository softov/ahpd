---
title: "A Claude turn ends with no tool call left running or waiting - implemented"
date: 2026-09-28
refs:
  - git://373253e
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `settleOpen`"
---

A Claude turn that ends, however it ends, leaves no tool call running or waiting for confirmation, so a later subscriber sees what a live watcher saw.

## What was built

- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `settleOpen` cancels every open call as `skipped`, as the protocol reducer's `endTurn` does, and denies a pending ask; called on complete, error, a dying CLI, cancel and a worker's end.

## Verified

- `agent-claude-subagent.test.ts`: an unclaimed ask on complete and on cancel, and a call still running on complete; all failed first.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1552 tests passed.

## Departures from the plan

- The worker case is not tested: its kept turn is read by nothing after it ends, and the host's reducer already cancels its open calls.

## Left for later

- By hand: a re-subscribe after a turn that ended with an open call.
