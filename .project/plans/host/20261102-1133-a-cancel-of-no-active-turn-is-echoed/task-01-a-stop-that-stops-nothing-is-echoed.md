---
title: A stop that stops nothing is echoed
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L464-L476](../../../../packages/sdk/src/host/chatactions.ts#L464-L476) - a stop on a session asleep"
  - "[code://packages/sdk/src/host/chatactions.ts#L1236-L1296](../../../../packages/sdk/src/host/chatactions.ts#L1236-L1296) - a stop on a chat"
---

## Objective

Three stops go to every client of the chat as the client's own action.
They are a stop on a sleeping session, a stop on a chat with no running turn, and a stop that names another turn.
Nothing is stopped, woken or asked of a backend for them.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:464-476` - a stop on a session asleep is echoed, with nothing woken.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1236-1296` - a stop that names no running turn is echoed, on a lead chat and a worker's chat alike.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:682-710` - a stop with no turn running is echoed to every client.
- `UPDATE: packages/sdk/test/session-wake.test.ts:446-466` - a stop on a sleeping session is echoed, and nothing wakes.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts:651-675` - a stop on an ended worker's chat is echoed, and stops nothing.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts` - a stop on a running worker's chat that names another turn stops nothing.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:515-519` - the oracle allows no refusal of a stop.
- `UPDATE: docs/sdk/AHP.md:276` - the `chat/turnCancelled` row.
- `UPDATE: .project/specs/sessions-and-chats.md:86-113` - a stop with no turn running, and a stop in a worker chat.

## Steps

1. Echo a stop on a session asleep in place of its refusal.
2. Echo a stop on a chat with no running turn, before the lead and worker paths.
3. Echo a stop that names another turn than the running one, on both paths.
4. Change the tests that held a refusal to hold the echo, and add the worker case.
5. Remove the oracle's refusal row for a stop.
6. Write the answer to a stop in `AHP.md` and in the spec.

## Validation

- The changed and new cases fail on `6e6d1ca8` and pass after.
- `packages/sdk/test/ahp-test-cases.test.ts` passes, every protocol case among them.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02 in `b12462af`.

- One test at the head of the stop's case echoes a stop with no running turn, or naming another.
- The test serves a lead chat and a worker's chat alike.
- A stop of a worker's running turn is refused when its lead runs nothing and its backend has no `stopWorker`.
- Nothing can carry that stop out, and it names a running turn.
- Two worker cases of `subagent-chat.test.ts` named a turn the worker was not running, `the-worker-turn`, and now name the worker's running turn, read from its chat.
- No protocol case sends a stop that the host refused, so the oracle's row was an allowance that nothing read.
