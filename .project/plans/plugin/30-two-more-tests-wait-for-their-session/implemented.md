---
title: Two more tests wait for what their session is still doing - implemented
date: 2026-09-30
refs:
  - git://aa66dec
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts](../../../../packages/agent-acp/test/agent-acp-ports.test.ts)"
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts)"
  - "[code://packages/computer/test/computer-devcontainer.test.ts](../../../../packages/computer/test/computer-devcontainer.test.ts)"
---

Three more test cases wait for what their session started before they read its results or remove its folder, so they no longer fail about one run in three.

## What was built

- [`code://packages/agent-acp/test/agent-acp-ports.test.ts`](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - `listed`: `afterEach` waits until the host's own catalogue read has sent `session/list` to its fixture server.
- [`code://packages/agent-cofold/test/agent-cofold-fork.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts) - `landed`: waits until the fork's kept runs have all their events and steps in the target.
- [`code://packages/computer/test/computer-devcontainer.test.ts`](../../../../packages/computer/test/computer-devcontainer.test.ts) - the daemon's-version case waits on `answered`, as its siblings do.

## Verified

- 0 failures in 40 file runs under load for each of the first two; the third file alone 24 of 24.
- Full `pnpm test` 3 times on main, 1753 tests each; CI green on `aa66dec`, 2026-09-30.

## Departures from the plan

- Task 03 was added after the daemon/09 review found a new case without the wait.
- Neither race showed as the assertion failing under local load; probes showed the writer still running in 107 of 360 acp folders and 39 of 40 cofold forks.

## Left for later

- None.
