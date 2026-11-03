---
title: A steering message taken back is withdrawn or refused - implemented
date: 2026-11-02
refs:
  - git://f88076de
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts)"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
---

A client that takes back a steering message gets an answer that holds.
cofold takes back a message its run handed back, the proxy carries the removal as `steering`, and a held one is refused.

## What was built

- [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts) - `unqueue` takes a steering message out of `untaken` and `steering`, and says it gone.
- A steer cofold's submit holds stays the run's, and the host refuses its removal during the turn.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - `unqueue` carries `steering` for the inner chat's steering message.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `unqueue` says what it takes back, citing the AHP rule.
- Docs: AHP.md's removal row, and CHATS.md's rule, cofold's take-back and pi's refusal.

## Verified

- `agent-cofold-turn.test.ts`: a client stops a run that holds a steer, and takes the handed-back message back.
- The removal's own echo answers it, and the next turn runs without the message.
- `agent-cofold-turn.test.ts`: the removal of a message the run holds gets the refusal, and the next step reads the message.
- `agent-pi-steering.test.ts`: the removal of a message pi holds gets the refusal, and the snapshot still holds it.
- `nested-proxy.test.ts`: the client outside gets the inner backend's `kind: steering` echo under `clientSeq` 8.
- On the continuation's code the cofold handed-back case fails: the host says the message gone, and it still runs as a third turn.
- On the continuation's code the nested case fails: the removal goes inside as `queued`, and the answer is a refusal.
- The two refusals pass on the continuation's code too, which refuses a removal during a turn when nothing is taken back.
- `pnpm typecheck` exits 0.

## Departures from the plan

- The first build, on main, added a `withdrawSteering` hook and its own refusal.
- In the union that met the continuation's refusal of the same removal, so the branch was built again on the continuation.
- It takes the continuation's refusal and adds the take-back to `unqueue`, and the hook went.

## Left for later

- Found beside the review's notes: an edit of a held steering message reaches the backend again.
- A second `chat/pendingMessageSet` under a held steering id calls `steer` a second time, and the agent gets both.
- AHP main says "Hosts MUST reject edits or client removals that they can no longer honor after handoff".
- It adds "Repeated identical upserts MUST NOT cause duplicate provider delivery."
- VS Code's host rejects a changed one and answers an identical one without a second delivery.
