---
title: The plan channel holds a plan
status: done
depends: []
layer: "tasks"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L240-L268](../../../../packages/sdk/src/types/plugin.ts#L240-L268) - `PluginChannel`, its `grant` and `snapshot`"
  - "[code://packages/sdk/src/types/plugin.ts#L773](../../../../packages/sdk/src/types/plugin.ts#L773) - `registerChannel`"
  - "[code://packages/bot/src/catalogue.ts#L85-L96](../../../../packages/bot/src/catalogue.ts#L85-L96) - the bots channel, a plugin channel to copy"
---

## Objective

A client subscribes to one plan on an `x-ahpd` channel, gets the plan as its state, and then gets one action for each change.

## Files

- `CREATE: packages/tasks/src/channel.ts` - the plan channel, its snapshot and its actions.
- `UPDATE: packages/tasks/src/plugin.ts` - register the channel, and publish on each record change.
- `CREATE: packages/tasks/test/tasks-channel.test.ts` - a subscribe and the actions after it.

## Steps

1. Register the channel with the URI `x-ahpd-plans://<plan id>`.
2. Ask the grant `session:read`.
3. Answer a subscribe with the plan record and the tasks that name it.
4. Publish `x-ahpd-plans/taskAdded` for a new task of the plan, with the task.
5. Publish `x-ahpd-plans/taskSet` for a changed task of the plan, with the task.
6. Publish `x-ahpd-plans/set` for a change to the plan itself.
7. Publish `x-ahpd-plans/taskRemoved` with the task id when a task leaves the store.

## Validation

- `packages/tasks/test/tasks-channel.test.ts`: a subscribe gets the plan; `task_add` then publishes `x-ahpd-plans/taskAdded`.
- `packages/tasks/test/tasks-channel.test.ts`: `task_set` publishes `x-ahpd-plans/taskSet`; a removed task publishes `x-ahpd-plans/taskRemoved` with its id; a reader without the grant cannot subscribe.
- `pnpm vitest run packages/tasks/test` passes.

## Resume

- **Done so far:** `packages/tasks/src/channel.ts` holds `planChannel(store)`. It answers with the scheme `x-ahpd-plans` and a URI per plan id. A subscribe asks `session:read` and is answered with a snapshot of `{ plan, tasks }`. Four actions follow: `taskAdded`, `taskSet`, `taskRemoved` and `set`. The plugin binds the channel after `registerChannel` and publishes each record change through `oneAtATime`. A removal has no record left to read, so the channel keeps the plan each task was last seen on, filled from the store when it is made and moved on by each change, and publishes the removal there with `taskId`. `packages/tasks/test/tasks-channel.test.ts` passes. A subscribe gets the plan. `task_add` publishes `taskAdded`, `task_set` publishes `taskSet`, a plan put publishes `set`, and a record removed from the collection publishes `taskRemoved`. A reader without the grant is refused.
- **Next action:** none for this task.
- **Open questions:** none. Softov chose "A taskRemoved action" on 2026-10-18. A task removed before the channel ever read it has no plan to publish on, and no subscriber can hold it either, because a subscribe reads the store as it then stands.
- **Watch out for:** `registerChannel` refuses an action type that does not start with the scheme, so every action is `x-ahpd-plans/...`. A URI under the scheme with no plan behind it is refused with `-32001` rather than answered with an empty state. The removal's plan is the one the task was last seen on, so a task whose file is deleted by hand after the channel was made is published, and one deleted before that is not.
