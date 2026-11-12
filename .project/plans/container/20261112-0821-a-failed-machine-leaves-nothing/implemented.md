---
title: A failed machine leaves nothing - implemented
date: 2026-11-12
refs:
  - git://239e83ede - the commit this work sits on
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - `cleanUpFailed`, and the run and seed guards"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `adopt` removes this daemon's unkept machines"
---

A machine that a create does not finish now leaves no container and no `ahpd-git-<name>` volume. A restart removes this daemon's own disposable machines whose session it does not keep, and still leaves another daemon's machines alone.

## What was built

- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `cleanUpFailed` removes a container and its git volume, and logs a removal that fails instead of throwing. The image `run` path puts `run`, `create`, `cp`, `start` and `seedGit` under one `try`. The dev container's `seedGit` call has its own `try`, and the seed no longer removes the container itself.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - `adopt` splits an unkept disposable machine into another daemon's, which stays, and this daemon's, which `made.remove` takes away with its volume. The log line names the machine and the session.
- [`code://packages/computer/test/computer-cleanup.test.ts`](../../../../packages/computer/test/computer-cleanup.test.ts) - a refused run and a failed seed, each with the machine list empty and no `ahpd-git-one` volume.
- [`code://packages/computer/test/computer-disposable.test.ts`](../../../../packages/computer/test/computer-disposable.test.ts) - a case for this daemon's unkept machine and its volume, and the two leftover cases changed by the new branch.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` prints nothing at the worktree root.
- The computer suite at review, 2026-11-12, merged with `main`: 604 passed, 1 skipped, 1 failed.
- The failure was `computer-git-fetch.test.ts` "answers nothing to bring back" on real Docker. It passes alone and in its whole file, 26 of 26.
- At review, the start removes only a machine whose `ahpd.host` names this daemon. A machine that names no daemon is left alone, with a line.
- No manual Docker run was made. The cases use the scripted Docker in `packages/computer/test/fixtures/docker.mjs`.

## Departures from the plan

- Task 01 named only the image `run` path. The dev container path is the seed's second caller, so it got the same `cleanUpFailed` guard. Without it, removing the seed's own catch (step 4) would have left that path with no cleanup.
- A refused `run` never made the volume, so its `volume rm` fails and `cleanUpFailed` logs one warning. The case asserts that line, because the plan asks for a failed cleanup to be logged.
- Two existing disposable cases seed a machine with no `ahpd.host` label and load with no `hostId`. In `adopt`, `mine` is then true, so the new branch would remove them. The leftover case now seeds another daemon's host label, and the `keptFor` case passes a store that keeps its session.

## Left for later

- The computer suite has not been run, so the three items in the plan's *Final verification checklist* stay unchecked.
- Nothing was deferred. No [deferred.md](deferred.md) is needed.
