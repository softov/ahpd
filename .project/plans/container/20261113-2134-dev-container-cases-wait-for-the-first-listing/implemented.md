---
title: Dev container cases wait for the first listing - implemented
date: 2026-11-13
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts](../../../../packages/computer/test/computer-devcontainer.test.ts) - `listing` on `load`, and the three cases"
---

Three dev container cases wait for the `docker ps` listing the load started before they ask for a machine. They no longer race it on Windows, where each Docker call is a new Node process.

## What was built

- [`code://packages/computer/test/computer-devcontainer.test.ts`](../../../../packages/computer/test/computer-devcontainer.test.ts) - `listings`, `listed`, and a `listing` that `load` answers. Three cases await it.
- The problem file of the three cases is deleted. The fourth case is in `problems/a-dev-container-case-waits-on-a-late-docker-call.md`.
- `problems/computer-cases-time-out-on-a-busy-machine.md` says the two cases also time out alone at a load of 1.5.

## Verified

- The file ran three times on Linux: 49 passed each time. The two failures each time are the cases of the busy-machine problem, which fail the same way at `46cec859d` with no change.
- `pnpm typecheck` is clean.

## Departures from the plan

- None.

## Left for later

- The fourth case, in its own problem file.
- The two cases of the busy-machine problem.
