---
title: pi continues from the failed call
status: done
depends: []
layer: agent-pi
refs:
  - "[code://packages/agent-pi/src/backend.ts#L34-L102](../../../../packages/agent-pi/src/backend.ts#L34-L102) - `PiBackend`"
  - "[code://packages/agent-pi/src/backend.ts#L433-L436](../../../../packages/agent-pi/src/backend.ts#L433-L436) - `rewind`, the nearest call that changes the conversation"
  - "[code://packages/agent-pi/test/fake-pi.ts#L87-L150](../../../../packages/agent-pi/test/fake-pi.ts#L87-L150) - the fake `PiBackend`"
  - npm://@earendil-works/pi-coding-agent@1.3.0 - `_omitRecoveryAttempt` in `dist/core/agent-session.js`, pi's own retry, which appends a context edit with `null`
---

## Objective

`PiBackend` gets `resume()`, which continues pi from a failed reply without a new message.
The failed reply stays in pi's file, and leaves the model's context.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:34-102` - add `resume()` to `PiBackend`, with its comment.
- `UPDATE: packages/agent-pi/src/backend.ts:346-439` - implement `resume()` over the `AgentSession`.
- `UPDATE: packages/agent-pi/test/fake-pi.ts` - add `resume()` to the fake, which records the call and answers what the test sets.

## Steps

1. Declare `resume(): Promise<boolean>` on `PiBackend`.
2. In `resume`, read the leaf entry from `session.sessionManager`.
3. Answer `false` when the leaf is not an assistant message with `stopReason` `error`.
4. Call `session.sessionManager.appendContextEdit(leafId, null)`, then `session.refreshContext()`.
5. Await `session.agent.continue()`, then answer `true`.
6. Let an error from `agent.continue()` reject the promise, so the session ends the turn with it.
7. Add `resume` to the fake in `fake-pi.ts`, with a setter for what it answers.

## Validation

- `pnpm typecheck` is clean.
- By hand, use a test ahpd under XDG directories, and resume a failed pi turn.
- Open the session with the `pi` command, and check that it shows the failed reply and the run after it.
