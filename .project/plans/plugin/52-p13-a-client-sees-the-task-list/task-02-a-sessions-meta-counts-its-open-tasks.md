---
title: A session's _meta counts its open tasks
status: done
depends: []
layer: "sdk, tasks"
refs:
  - "[code://packages/sdk/src/host/facts.ts#L40-L60](../../../../packages/sdk/src/host/facts.ts#L40-L60) - `metaOf`, which composes a session's `_meta`"
  - "[code://packages/sdk/src/types/records.ts](../../../../packages/sdk/src/types/records.ts) - `watch`, which hears each change to a collection"
---

## Objective

A session's `_meta` holds the count of its open tasks, and a client hears a new count with `session/metaChanged`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - the registration `registerSessionMeta(key, read)`.
- `UPDATE: packages/sdk/src/host/facts.ts:40-60` - add each plugin's key to the `_meta` that `metaOf` composes.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - check and fold the new registration.
- `UPDATE: docs/plugins/PLUGINS.md` - the new registration kind.
- `UPDATE: packages/tasks/src/plugin.ts` - register the count, and send a change when a task changes.
- `CREATE: packages/tasks/test/tasks-meta.test.ts` - the count for a session.

## Steps

1. Add the registration `registerSessionMeta(key, read)`.
2. Add each registered key to the `_meta` that `metaOf` composes.
3. Give the plugin a call that sends `session/metaChanged` for one session.
4. Count the tasks of the session's plan and the tasks whose `session` names it.
5. Count every status but `done` and `dropped`, and give it as `ahpd.tasks` `{ open: n }`.
6. Send `session/metaChanged` for each session whose count a task change moves.

## Validation

- `packages/tasks/test/tasks-meta.test.ts`: a session with two open tasks and one `done` task counts two.
- `packages/tasks/test/tasks-meta.test.ts`: setting a task to `done` sends a new count.
- `packages/sdk/test/plugin-validate.test.ts`: the new registration refuses an empty object.
- `pnpm vitest run packages/tasks/test packages/sdk/test` passes.

## Resume

- **Done so far:** `registerSessionMeta(key, read)` and `sessionMetaChanged(uri)` are in the plugin host. The fold keeps the served object it was given. A copy would leave the host's `changed` on the copy and the registration's check on the original. `metaOf` composes each registered key into the session's `_meta`. The tasks plugin registers `ahpd.tasks` as `{ open: n }` and recounts on each change to the two collections. It announces each session whose count moved. `packages/tasks/test/tasks-meta.test.ts` and the new case in `plugin-validate.test.ts` pass.
- **Next action:** none for this task.
- **Open questions:** none. The count is kept from the records, so it is a view of them, as planned.
- **Watch out for:** the first recount fills the counts without announcing, because a host composes `_meta` from the map when it is read. Only a count that moves announces `session/metaChanged`, and a session no task names has no key at all.
