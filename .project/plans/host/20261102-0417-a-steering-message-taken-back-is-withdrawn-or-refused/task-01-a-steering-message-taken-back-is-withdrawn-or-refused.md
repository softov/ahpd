---
title: A steering message taken back is withdrawn or refused
status: done
depends: []
layer: "agent-cofold, sdk sessions"
refs:
  - "[code://packages/agent-cofold/src/turns.ts#L787-L793](../../../../packages/agent-cofold/src/turns.ts#L787-L793) - cofold's `unqueue`"
  - "[code://packages/sdk/src/sessions/nested.ts#L1415-L1417](../../../../packages/sdk/src/sessions/nested.ts#L1415-L1417) - the proxy's `unqueue`"
---

## Objective

cofold's `unqueue` takes back a steering message from `untaken` and says it gone.
The proxy carries a removal inside under the kind the inner chat holds the message as.

## Files

- `UPDATE: packages/agent-cofold/src/turns.ts:787-793` - `unqueue` looks in `untaken` first, and says a steering message gone.
- `UPDATE: packages/sdk/src/sessions/nested.ts:1415-1417` - `unqueue` carries `steering` for the inner chat's steering message.
- `UPDATE: packages/sdk/src/types/session.ts:671-672` - `unqueue` says what it takes back, and what the host does with the rest.
- `UPDATE: docs/sdk/AHP.md:287` - the removal row says when a steering message is taken back.
- `UPDATE: docs/sdk/CHATS.md:47-55` - the rule, cofold's take-back, and pi's refusal.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - a handed-back message taken back, and a held one refused.
- `CREATE: packages/agent-pi/test/agent-pi-steering.test.ts` - pi's held message refused through the host.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - a nested removal answered by the host inside.

## Steps

1. Make cofold's `unqueue` take a steering message out of `untaken` and `steering`, and say it gone.
2. Make the proxy's `unqueue` carry the kind its mirror holds the message as.
3. Write the four cases, and run each against the continuation's code.
4. Write the docs and the interface's doc.

## Validation

- `agent-cofold-turn.test.ts`: a stopped run hands a message back, a client takes it back, and the next turn never runs it.
- `agent-cofold-turn.test.ts`: the removal of a message the run holds gets the refusal, and the run still reads it.
- `agent-pi-steering.test.ts`: the removal of a message pi holds gets the refusal, and the snapshot still holds it.
- `nested-proxy.test.ts`: the client outside gets the inner backend's `kind: steering` echo under its own `clientSeq`.
- On the continuation's code the cofold handed-back case and the nested case fail.
- `pnpm typecheck` exits 0.

## Resume

Done 2026-11-02 in `f88076de`; [implemented.md](implemented.md) says what was verified.
