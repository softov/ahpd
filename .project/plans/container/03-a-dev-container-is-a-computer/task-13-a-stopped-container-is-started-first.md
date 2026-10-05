---
title: The relay starts a stopped container before reaching it
status: implemented
depends: [task-07-the-fake-cli-behaves-like-the-real-one.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L358-L367](../../../../packages/computer/src/devcontainer.ts#L358-L367) - `connect` skips `up` when `existing` answers and the remote folder is remembered, whatever the container's status"
  - "[code://packages/computer/src/plugin.ts#L839-L840](../../../../packages/computer/src/plugin.ts#L839-L840) - `machineFor`, the `existing` the plugin hands in, which ignores the status the listing carries"
---

## Objective

`connect` for a folder whose container is stopped runs `up` (which starts it) before the first `docker exec`, instead of reaching a stopped container.

## Files

- `UPDATE: packages/computer/src/plugin.ts:839-840` - `machineFor` answers the status with the id.
- `UPDATE: packages/computer/src/devcontainer.ts:358-367` - only a running container skips `up`.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - the case below.

## Steps

1. A container `up` starts again keeps its id, so the probe kept for it (task 18) is still its own and is not run again.

## Validation

- A folder whose labelled container is stopped: `connect` runs `up` and then reaches it; today it skips `up` and the fake Docker refuses the `docker exec` on a stopped container (task 07).

## Resume

Implemented on 2026-10-03.

Files changed:

- `packages/computer/src/devcontainer.ts` - `existing` answers `{ id, running }` rather than an id, and `connect` takes the skip only when the container is running. A stopped one falls through to `up`, which starts it and answers the same id.
- `packages/computer/src/plugin.ts` - `machineFor` reads the status the listing already carries (`isRunning`) and hands both back; its two other users, the connect route's owner and its stretch, read `machine.id`.
- `packages/computer/test/devcontainer.test.ts` - the case below, plus one expectation in the derivation case below it.

What the tests cover: a folder whose container the first connect made is marked `exited` in the scripted Docker, and the second connect on the same launcher runs `up` a second time, keeps the one machine under the same id, and runs its commands in it. With `known.running` read as `true` the case fails with the fake Docker's own sentence, `container abc123 is not running`, which is the refusal the task names.

Notes and open questions:

- Step 1 holds as the task says, and it holds because the launcher never re-probes for an id it already has: the probe is kept under the container id and `reachedDevContainer` reads it back only when its own record has no kept probe for that same container. Since `up` answers the id the labels name, the id is unchanged, so the kept probe stays its own and no second probe runs. Nothing had to be written for this; it is what the code already did, and the case's one machine under one id is what shows it.
- The status comes from the listing, so a container stopped between the listing and the first `docker exec` is still refused. Nothing here narrows that window; the CLI's own `docker exec` is refused the same way, and the relay's refusal is reported with the container's name.
- The plugin-level wiring is covered by the existing connect cases in `computer-devcontainer.test.ts` rather than by a case of its own: `machineFor` is a two-line read of what the listing already answered, and the only behaviour that changed is the type it hands back, which `pnpm exec tsc --noEmit` covers.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` green after task 13.
