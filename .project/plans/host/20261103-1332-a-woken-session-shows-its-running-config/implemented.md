---
title: A woken session shows its running config - implemented
date: 2026-11-03
refs:
  - git://9fcb5d90 - the change
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts)"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts)"
---

A session's state read from its record holds the config its running state holds.
The schema carries a plugin's keys, and the values are the defaults with the stored values over them.
This host's own keys are laid on both.
A wake keeps that state, so a client draws the same controls before and after the wake.
A start of a session's lead under a held state says the backend's customizations where they differ from the state's.

## What was built

- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts) - `recordSeed` composes the config as a running state does, with `mergedConfig` where the host decided its own keys.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - the end of `spawn` compares the lead's customizations with a held state's, and says them by `session/customizationsChanged`.
- [`code://packages/sdk/test/session-wake.test.ts`](../../../../packages/sdk/test/session-wake.test.ts) - host options and a probe that answers late, and the two cases.

## Verified

- On `c97d8459`'s sources both new cases fail, and they pass with the change.
- On those sources the woken state misses a plugin's default, and holds no customizations once the backend has some.
- These sdk test files pass, one file at a time: the wake, the sleep, snapshots, session config, config order and fixed keys.
- So do the sdk's files for scope, the catalogue, client plugins, the harness, names and the nested proxy.
- So do the files for conformance, worktrees, root config and tools.
- So do the backend files that restore through a host: Claude's subagent restore and pi's truncate, fork and declared files.
- So do cofold's approval and plugin files, and ACP's turn file.
- On a merge of this branch and the residency branch, the wake and sleep cases pass.
- On that merge, a session the residency let go holds the config it ran with once it is read from its record and woken.
- On the residency branch alone, that session does not.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

None.
