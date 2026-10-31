---
title: pi answers a steering message and takes it out when pi reads it
status: done
depends: []
layer: agent-pi
refs:
  - "[code://packages/agent-pi/src/session.ts#L1340-L1367](../../../../packages/agent-pi/src/session.ts#L1340-L1367) - pi's `steer`"
  - "[code://packages/agent-pi/src/backend.ts#L44](../../../../packages/agent-pi/src/backend.ts#L44) - the backend's `steer`"
---

## Objective

A steering message a client sends while a pi turn runs is said back inside the dispatch, held as the chat's `steeringMessage`, and taken out with `chat/pendingMessageRemoved` once pi's steering queue no longer holds it.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts` - `steer` answers with what pi did with the message: queued, or handled by an extension.
- `UPDATE: packages/agent-pi/src/session.ts` - `steer` says and holds the message; pi's `queue_update` takes out the messages it no longer holds; `chatState` holds the one waiting.
- `UPDATE: packages/agent-pi/test/fake-pi.ts` - the fake's `steer` answers `queued`.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the message said and held, and taken out when pi's queue is empty again.

## Steps

1. Write the case and run it on `ab07054c` to see nothing said for the message.
2. Say and hold the message, and take it out by pi's queue.

## Validation

- The new case fails on `ab07054c` and passes after the change.
- The agent-pi suite passes.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

Done 2026-10-31.
Every step is built, and the touched suites, the type check and the boundary check pass.
