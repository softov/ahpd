---
title: Pinned sessions and the overlap modes
status: done
depends: [task-04-a-matched-rule-starts-a-run.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L561-L708](../../../../packages/sdk/src/host/automations.ts#L561-L708) - `beginAutomation`"
  - "[code://packages/sdk/src/host/automations.ts#L368-L484](../../../../packages/sdk/src/host/automations.ts#L368-L484) - `fly`, `hold`, `skip` and `request`, which is what each overlap does"
---

## Objective

A pinned automation adds a turn to one chat each run.
An event during a run does what the automation's `overlap` says.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts:439-533` - begin a turn in the pinned chat, or make the session and keep its URI.
- `UPDATE: packages/sdk/src/automations.ts` - read `_meta.ahpd`, and refuse `pinned` with `parallel`.
- `UPDATE: packages/sdk/src/host/actions.ts` - drop a `pinnedSession` a client wrote, and keep the one the host holds.
- `UPDATE: packages/sdk/test/automation-wake.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/automations.test.ts` - the case about a client's write.

## Steps

1. Read `session` and `overlap` from `_meta.ahpd`, with `new` and `queue` as the defaults.
2. For `pinned`, begin the next turn in the session `pinnedSession` names. Wait until that chat is free and the automation's owner may work in it.
3. When that session is gone, make a new one and write its URI to `pinnedSession`.
4. For `queue`, keep one waiting run and fold later events into it.
5. For `steer`, send the event as a message into the running turn, and queue when no turn runs.
6. For `parallel`, start a run for each event.
7. For `skip`, drop the event and count it on the running run.
8. On save, refuse `pinned` with `parallel` in one sentence.
9. Apply the same rules to a schedule trigger. A run a person presses does not wait behind one that is going. The host answers the press with the run it started. The host refuses a press on a pinned automation while its chat has a turn running.

## Validation

- `it('runs a pinned automation as the next turn in the same chat')`
- `it('makes a new pinned session when the old one is gone')`
- `it('queues one run and folds the rest while one runs')`
- `it('steers the running turn, and queues when nothing runs')`
- `it('starts a run for each event under parallel')`
- `it('drops and counts events under skip')`
- `it('refuses a pinned automation with parallel')`
- `it('refuses to run an automation pinned to a chat that belongs to somebody else')`
- `it('refuses a press into a chat the automation owner may not read')`
- `it('refuses a press while the chat the automation runs in is busy')`
- `it('waits behind a turn a person is running in the chat it is pinned to')`
- `it('stops measuring a turn in a session that is gone')`
- `it('starts no run once the host has closed')`
- `it('keeps the pinned chat the host holds, whatever a client writes')`
- Run the full gates from the plan. All pass.

## Resume

Built in `host/automations.ts`. `wakeOf` defaults to `new` and `queue`. `request` is what an event arriving mid-run does. `hold` and `release` are the one waiting run events fold into. `fly`, `fireRun`, `beginIn` and `keepPinned` run the turn, and the pinned branch sits at the top of `beginAutomation`. `automations.ts` refuses `pinned` with `parallel` on both `create` and `update`, and gained `note` so a dropped event is counted on the run it arrived during. `types/automations.ts` carries `AutomationRun.notes`, sent as `_meta` on the run's summary and its state. Thirteen cases in `automation-wake.test.ts` are this task's, and one in `automations.test.ts` is that a client cannot write the pinned chat at all.

A pinned run is the one road into a session that does not go through `createSession`. The pinned branch asks what that road asks. The chat belongs to the automation's owner or to nobody. The owner has signed in and may `session:read`. The chat passes the same admission a session gets. It also asks whether the chat is free. `pinBusy` reads the chat's own status, so a person typing there counts. `heldBy` keeps the origin on a run of this automation that has not settled. So a second turn never starts in that chat, and a run still going keeps the sessions it was given. A person's press gets the same question, which the overlap mode does not otherwise put to a run. The host refuses a press on a pinned automation while its chat is running a turn, whoever started it. The `idle` the stream says right after a turn end does not break a wait for quiet. That is the other half of a pinned run being able to hold one at all. `forget`, `end` and `stop` are the other end of it. A chat that is gone, a session this host was running and the host's own close all drop what was being measured for them.

