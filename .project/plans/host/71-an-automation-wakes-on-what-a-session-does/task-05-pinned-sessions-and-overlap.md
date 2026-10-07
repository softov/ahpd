---
title: Pinned sessions and the overlap modes
status: todo
depends: [task-04-a-matched-rule-starts-a-run.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L170-L205](../../../../packages/sdk/src/host/automations.ts#L170-L205) - `beginAutomation`"
---

## Objective

A pinned automation adds a turn to one chat each run.
An event during a run does what the automation's `overlap` says.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts:170-205` - begin a turn in the pinned chat, or make the session and keep its URI.
- `UPDATE: packages/sdk/src/automations.ts` - read `_meta.ahpd`, and refuse `pinned` with `parallel`.
- `UPDATE: packages/sdk/test/automation-wake.test.ts` - the cases below.

## Steps

1. Read `session` and `overlap` from `_meta.ahpd`, with `new` and `queue` as the defaults.
2. For `pinned`, begin the next turn in the session that `pinnedSession` names.
3. When that session is gone, make a new one and write its URI to `pinnedSession`.
4. For `queue`, keep one waiting run and fold later events into it.
5. For `steer`, send the event as a message into the running turn, and queue when no turn runs.
6. For `parallel`, start a run for each event.
7. For `skip`, drop the event and count it on the running run.
8. On save, refuse `pinned` with `parallel` in one sentence.
9. Apply the same rules to a schedule trigger and a manual run.

## Validation

- `it('runs a pinned automation as the next turn in the same chat')`
- `it('makes a new pinned session when the old one is gone')`
- `it('queues one run and folds the rest while one runs')`
- `it('steers the running turn, and queues when nothing runs')`
- `it('starts a run for each event under parallel')`
- `it('drops and counts events under skip')`
- `it('refuses a pinned automation with parallel')`
- Run the full gates from the plan. All pass.

## Resume

