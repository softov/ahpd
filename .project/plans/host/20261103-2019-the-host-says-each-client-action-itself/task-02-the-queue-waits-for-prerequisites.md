---
title: The queue waits for the host's prerequisites only
status: done
depends: [task-01-the-host-says-the-clients-action.md]
layer: host
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `dispatchQueues`, `behind` and `dispatchAction`"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - a draft for a session not running, in the queue"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - a turn's end said as the backend says it"
---

## Objective

A client's dispatches wait, per client id, only while an earlier one waits on what the host must have to apply it.
No wait has a time limit, and nothing holds a backend's turn end.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the queue keyed by client id; `bounded` and `WAIT_LIMIT` go.
- `UPDATE: packages/sdk/src/host/chatactions.ts`, `packages/sdk/src/host/actions.ts` - the waits unbounded; a draft for a session not running joins the queue.
- `UPDATE: packages/sdk/src/host/context.ts` - `bounded` goes.
- `UPDATE: packages/sdk/src/host/spawn.ts` - the plan-read hold on a turn's end goes.
- `UPDATE: docs/sdk/AHP.md` - the `dispatchAction` row.

## Steps

1. Key the dispatch queue by client id across that client's connections (row 5).
2. Remove the time limit on every wait (rows 5, 6; H2-0012).
3. Reject a queued dispatch that fails with its own message (row 6).
4. Move a draft for a session not running into the queue (row 5, H2-0013).
5. Say a turn's end as the backend says it, the Plan call completed first (C-0099).

## Validation

- A dispatch held behind its client's waiting one, sent on another connection.
- A draft for a session not running said before the client's next dispatch.
- A restart wait and a catalogue read over 60 s answered when they end.
- A turn's end said while a plugin still holds the list behind it.

## Resume

- **Kept, against the holds table:** the root config port write, before the echo.
- **Why:** the port's file holds the daemon's keys, so its write is the change applied, as VS Code applies before it says.
- **Kept until 03:** a policy check holds its client's queue, since it comes before the echo until 03.
- **Moved to 01:** `taken` and `awaited`, which went with the matching.
