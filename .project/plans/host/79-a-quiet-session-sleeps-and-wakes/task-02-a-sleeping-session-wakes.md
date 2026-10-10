---
title: A sleeping session wakes when something needs it
status: todo
depends: [task-01-a-quiet-session-sleeps.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L298-L450](../../../../packages/sdk/src/host/chatactions.ts#L298-L450) - the lazy resume on `chat/turnStarted`, lifted into `wake`"
  - "[code://packages/sdk/src/host/automations.ts#L324-L328](../../../../packages/sdk/src/host/automations.ts#L324-L328) - `pinnedChat`, which answers only for a live session"
  - "[code://packages/sdk/src/host/automations.ts#L703-L778](../../../../packages/sdk/src/host/automations.ts#L703-L778) - `beginAutomation`, which reads `sessions.get(pin)`"
  - "[code://packages/sdk/src/host/sessionevents.ts#L255-L310](../../../../packages/sdk/src/host/sessionevents.ts#L255-L310) - `childFinished`, delivered only to a live parent"
---

## Objective

`wake(uri, chat?)` is the one way a session that is not live comes back.
A prompt, a pinned automation and a child's `childFinished` each call it, and the session resumes in place with its earlier conversation.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:298-450` - move the lazy resume out into `wake`, and call `wake` from `chat/turnStarted`.
- `UPDATE: packages/sdk/src/host/sleep.ts` - add `wake(uri, chat?)`; concurrent calls for one URI share one resume.
- `UPDATE: packages/sdk/src/host/automations.ts:324-328` - `pinnedChat` reads the catalogue for a session that is not live and wakes it.
- `UPDATE: packages/sdk/src/host/automations.ts:703-778` - `beginAutomation` wakes a sleeping pinned session before it begins the run.
- `UPDATE: packages/sdk/src/host/sessionevents.ts:255-310` - `childFinished` wakes a sleeping parent before it delivers the event.
- `CREATE: packages/sdk/test/session-wake.test.ts` - the cases below.

## Steps

1. Write the cases in `session-wake.test.ts` first, with a fake backend that counts spawns and resumes.
2. Lift the resume path from `chat/turnStarted` into `wake(uri, chat?)` without changing what it does.
3. Make concurrent `wake` calls for the same URI await one resume.
4. Call `wake` from `chat/turnStarted` where the session is not live.
5. In `pinnedChat` and `beginAutomation`, wake a pinned session that is in the catalogue and not live.
6. In `childFinished`, wake a parent that is in the catalogue and not live, then deliver the event.
7. Leave a session that `wake` cannot resume as it is, and fail the action that asked with the resume error.
8. Publish `root/activeSessionsChanged` after a wake.

## Validation

- `it('wakes a sleeping session on a prompt and answers with the earlier conversation')`
- `it('wakes a pinned session for an automation run and makes no new session')`
- `it('wakes a parent for a child's childFinished')`
- `it('resumes once when two wakers arrive together')`
- `it('fails the action with the resume error when a session cannot resume')`
- Run the full gates from the plan. All pass.

## Resume
