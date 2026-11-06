---
title: The session's plan takes a harness list
status: done
depends: [task-01-a-backend-hands-its-list-to-the-host.md]
layer: "tasks"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L919](../../../../packages/sdk/src/types/plugin.ts#L919) - `on`, how the tasks plugin hears the event"
  - npm://@agentclientprotocol/sdk@^1.8.0 - `PlanEntry`, the statuses and priorities a whole list carries
---

## Objective

A harness list writes the tasks of the session's plan, and the plan stays across turns.
A whole list matches by text, a missing step is dropped, and a clear after every step is complete drops nothing.

## Files

- `CREATE: packages/tasks/src/translate.ts` - the session's plan, the text match, and a change by the harness's id.
- `UPDATE: packages/tasks/src/record.ts` - the third scope `session`, with the session id as text.
- `UPDATE: packages/tasks/src/plugin.ts` - hear the event of task 01 in `apply`.
- `CREATE: packages/tasks/test/tasks-translate.test.ts` - each kind of list and change.

## Steps

1. Find the session's plan, or make it on the first list with the scope `session`. Give it the event's title and an empty goal. Where the event carries no title, the plan is `Session <id>`.
2. Map `pending` to `todo`, `in_progress` to `doing`, `completed` to `done` and `deleted` to `dropped`.
3. Match each entry of a whole list to the first unmatched task with the same text.
4. Add a task for an entry that matches none, with `source` set to the tool and no harness id.
5. Set each task of the plan that the list does not hold to `dropped`, and keep its record.
6. Drop nothing when the list is empty and every task of the plan is `done`.
7. Find the task of a single change by the harness's id in `source`, or add it.
8. Keep the `priority` of an entry on its task.
9. Write `by` on the stamps with the sender of the turn.

## Validation

- `packages/tasks/test/tasks-translate.test.ts`: a first list makes the plan; a second list in another turn writes the same plan.
- `packages/tasks/test/tasks-translate.test.ts`: the plan takes the event's title, and `Session <id>` where the event has none.
- `packages/tasks/test/tasks-translate.test.ts`: a step missing from the next list reads `dropped`, and its record stays.
- `packages/tasks/test/tasks-translate.test.ts`: an empty list after every step is `done` drops nothing.
- `packages/tasks/test/tasks-translate.test.ts`: a change by harness id updates its task, and `source` keeps the id.
- `pnpm vitest run packages/tasks/test` passes.

## Resume

- **Done so far:** every step. `SessionScope` is the third scope in `record.ts`, with `session` as text, and `scopeOf` and `checkScope` know it. `translate.ts` makes the session's plan on the first update. It matches a whole list by text, adds what matches nothing and drops what the list no longer holds. It finds a single change by the harness's id in `source`. `plugin.ts` hears `plan_update` and runs the translation one update at a time with the tool calls. The plan tools still take a folder or a bot, and refuse a session scope.
- **Files:** `packages/tasks/src/record.ts`, `packages/tasks/src/plans.ts`, `packages/tasks/src/translate.ts`, `packages/tasks/src/plugin.ts`, `packages/tasks/test/tasks-translate.test.ts`, `packages/tasks/test/tasks-record.test.ts`, `packages/tasks/test/tasks-plans.test.ts`, `packages/sdk/src/types/index.ts`.
- **Next action:** task 03.
- **Open questions:** none.
- **Watch out for:** the plan's scope and the `Session <id>` fallback use `idOf(event.session)`, so a provider spelling such as `claude:/one` gives the id `one`. A later update that carries a title renames the plan, so the title answer holds when the title arrives after the first list. The plan starts `draft`, as `docs/plugins/TASK-LIST.md` says every plan does. A harness status that is not one of the four leaves the status where it is, and an added task starts `todo`. A change that names no task the plan holds and carries no text throws, so the host reports it. `PlanUpdateEvent`, `PlanUpdate`, `HarnessPlanEntry` and `HarnessPlanChange` are now on the SDK's type surface.
