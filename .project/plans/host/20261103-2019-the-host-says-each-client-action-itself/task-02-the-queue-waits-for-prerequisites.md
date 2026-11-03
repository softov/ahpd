---
title: The queue waits for the host's prerequisites only
status: todo
depends: [task-01-the-host-says-the-clients-action.md]
layer: host
refs:
  - "[code://packages/sdk/src/host.ts#L2160-L2260](../../../../packages/sdk/src/host.ts#L2160-L2260) - the per-connection chain, `taken`, `awaited`, `bounded`"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - a draft for a session not running, applied outside the chain"
---

## Objective

A client's dispatches wait, per client id, only while an earlier one waits on a session's restore, its attachments or a review's state.
Nothing waits on a backend's answer, and no wait has a time limit.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the queue keyed by client id; `taken`, `awaited`, `bounded` and `WAIT_LIMIT` go.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a wake, a catalogue read, attachments and a review wait in the queue; a draft for a session not running joins it.
- `UPDATE: packages/sdk/src/host/state.ts` - `Dispatched.taken` and `Dispatched.owed` go.

## Steps

1. Key the dispatch queue by client id across that client's connections (row 5).
2. Queue a dispatch only for a restore, an attachment rewrite or a review (row 5).
3. Remove the wait on a backend's answer and its time limit (rows 5, 6).
4. Reject a queued dispatch that fails with its own message (row 6).
5. Move a draft for a session not running into the queue (row 5, H2-0013).
6. Say a root config change at once, and persist it after (holds table).

## Validation

- Add a case per kept prerequisite: the host applies the client's later dispatch after it.
- Add a case per removed hold: the host applies a nested session's second action at once.
- Add a case for a wake over 60 s: the host applies the dispatch once the wake ends.

## Resume

