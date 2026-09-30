---
title: A test that ends a session waits for its cleanup to finish before removing its folder - implemented
date: 2026-09-29
refs:
  - git://944b9cd
  - git://2221a3c
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts)"
  - "[code://packages/sdk/test/worktrees.test.ts](../../../../packages/sdk/test/worktrees.test.ts)"
  - "[code://packages/computer/test/computer-devcontainer.test.ts](../../../../packages/computer/test/computer-devcontainer.test.ts)"
---

Three test files that removed their temporary folder while something the case started was still writing into it now wait for that writer, so CI no longer fails on `ENOTEMPTY`.

## What was built

- [`code://packages/agent-cofold/test/agent-cofold-tools.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts) - `settled`: waits until the closed session's runs are finished and their last event is `run.finished`.
- [`code://packages/sdk/test/worktrees.test.ts`](../../../../packages/sdk/test/worktrees.test.ts) - `cleared`: waits until git lists one worktree and the session's branch is gone.
- [`code://packages/computer/test/computer-devcontainer.test.ts`](../../../../packages/computer/test/computer-devcontainer.test.ts) - `answered`: waits until the scripted docker has answered each case's calls and let go of its lock.

## Verified

- Full `pnpm test` 3 times per task in the worktree, and once on main before each commit (1716 tests); the dev container file alone 24 of 24.
- CI green on `944b9cd`, 2026-09-29, after red on `c5dbe8c`.

## Departures from the plan

- Tasks 02 and 03 were added after the first review gates hit the same race in two more files.
- The dev container waits use call counts taken from a probe, since the plugin has no close hook to await its startup listing; a stale count fails on its own message.

## Left for later

- None.
