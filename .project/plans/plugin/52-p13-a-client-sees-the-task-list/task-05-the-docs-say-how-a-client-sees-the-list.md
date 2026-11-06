---
title: The docs say how a client sees the list
status: done
depends: [task-01-the-plan-call-is-drawn-from-the-host.md, task-02-a-sessions-meta-counts-its-open-tasks.md, task-03-the-plan-channel-holds-a-plan.md]
layer: "docs"
refs:
  - "[code://docs/plugins/BOTS.md](../../../../docs/plugins/BOTS.md) - how the bots channel is described, the shape to copy"
---

## Objective

`docs/plugins/TASK-LIST.md` says what a client sees: the Plan call, the open count in `_meta`, and the plan channel.

## Files

- `UPDATE: docs/plugins/TASK-LIST.md` - the Plan call, the `_meta` key, and the channel with its state and actions.

## Steps

1. Say that a turn shows one Plan call with the lines of the session's plan.
2. Name the `_meta` key, its value and the statuses it counts.
3. Give the channel's scheme, its grant, its state and each action, with a sample.
4. Say that the channel is an `x-ahpd` extension, and link the proposal.

## Validation

- The docs match the code of tasks 01 to 03.

## Resume

- **Done so far:** `docs/plugins/TASK-LIST.md` has a `What a client sees` section with three parts. It gives the turn's one Plan call and `Start.plan`. It gives `_meta['ahpd.tasks']` as `{ open: n }`, with the statuses it counts. It gives the `x-ahpd-plans` channel with its URI, grant, state and the four actions in a table, `taskRemoved` with `taskId` among them, and the sample `{ "ahpd.tasks": { "open": 2 } }`. It says the channel is an `x-ahpd` extension and links the proposal.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** the action names in the docs, `packages/tasks/src/channel.ts` and the proposal are one set. A rename is a change to all three.
