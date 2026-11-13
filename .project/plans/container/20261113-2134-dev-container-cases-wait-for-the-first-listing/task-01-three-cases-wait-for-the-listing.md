---
title: Three cases wait for the listing
status: implemented
depends: []
layer: "computer tests"
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts](../../../../packages/computer/test/computer-devcontainer.test.ts) - `load`, `listing` and the three cases"
---

## Objective

`load` answers a `listing` that waits for the `docker ps` the load started. The three cases that ask for a machine right after a load await it.

## Files

- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - `listings`, `listed`, `listing` on `load`, and the three cases.
- `DELETE: .project/problems/dev-container-cases-ask-before-the-first-listing.md` - the three cases it names are fixed.
- `CREATE: .project/problems/a-dev-container-case-waits-on-a-late-docker-call.md` - the fourth case, whose cause is not the listing.
- `UPDATE: .project/problems/computer-cases-time-out-on-a-busy-machine.md` - the two cases also time out at a low load.

## Steps

1. Add `listings(state)`, the `ps` calls the scripted Docker recorded.
2. Add `listed(state, count)`, which waits for `count` listings and no lock, as `answered` waits.
3. In `load`, count the listings before the load, and answer `listing`, which waits for one more.
4. Call `listing` in "refuses a command in a container that is not running".
5. Call `listing` after the second load of "reads the kept probe back after a restart".
6. Call `listing` in "omits the dev container row for a URI it cannot read a folder from".
7. Move the fourth case to a problem file of its own, and delete the old problem.

## Validation

- `npx vitest run packages/computer/test/computer-devcontainer.test.ts` passes three times in a row, apart from the two cases of the busy-machine problem.
- `pnpm typecheck` passes.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
