---
title: A stop takes the steering with it, and a failed resume resumes again
status: todo
depends: [01]
layer: host
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the steering a stopped turn leaves, taken out"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - pi's `cancel`"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `resume` and `clearSteering`"
  - ".project/problems/a-backend-keeps-a-steer-the-client-took-back.md - the filed problem the stop closes for pi"
  - ".project/problems/a-pi-resume-after-a-failed-continue-is-refused.md - the filed problem the resume closes"
---

## Objective

A stop takes the chat's steering message with it, as VS Code's host clears every pending steering entry at a cancel.
The backend lets go of the steering it holds, and pi empties its own steering queue.
A pi resume whose continue threw is resumed again from the same failed reply.

## Files

- `UPDATE: packages/sdk/src/host.ts` - at a stop, the backend is asked to let go of the steering message, and one it keeps is taken out.
- `UPDATE: packages/agent-pi/src/session.ts`, `packages/agent-pi/src/backend.ts` - `clearSteering` at a stop; `failedReply`, read by `resume`.
- `UPDATE: packages/agent-pi/test/fake-pi.ts` and the pi cases that build a backend by hand - `clearSteering`.
- `UPDATE:` the host steering cases, the pi steering cases and the pi disk cases.

## Steps

1. Take the steering message out of a chat at a stop, once its backend has had the stop.
2. Have pi empty its steering queue at a stop.
3. Read a context edit over a failed reply as that reply, in `resume`.
4. Add a case for each.

## Validation

- The new cases fail on `feb72387`'s sources and pass after.
- Every test file a stop or a steer reaches passes, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
