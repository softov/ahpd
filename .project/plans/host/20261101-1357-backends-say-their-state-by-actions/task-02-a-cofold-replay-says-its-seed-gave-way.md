---
title: A cofold replay says its seed gave way
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/runs.ts](../../../../packages/agent-cofold/src/runs.ts) - `reopen`, which replays a paused run"
  - "[code://packages/agent-cofold/test/agent-cofold-plugin.test.ts](../../../../packages/agent-cofold/test/agent-cofold-plugin.test.ts) - the late client that must see the open turn once"
---

## Objective

A paused cofold run resumed after a restart shows its open turn once, to every client, because the seeded copy leaves by an action.

## Files

- `UPDATE: packages/agent-cofold/src/runs.ts` - `reopen` emits `chat/truncated` back to the turn before the seeded copy it drops.

## Steps

1. Find the seeded copy of the open turn in `reopen`, as it does today.
2. Drop it from the backend's list.
3. Emit `chat/truncated` naming the turn before it, or no turn when it is the first.

## Validation

- `agent-cofold-plugin.test.ts` "resumes a paused run and shows the open turn once" fails without the change, with two copies.
- With the change it passes, and so does the rest of the file.

## Resume

Not started.
