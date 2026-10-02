---
title: A turn names where a fork cuts
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/sdk/src/types/session.ts#L230-L242](../../../../packages/sdk/src/types/session.ts#L230-L242) - `forkPoint`, as host 19 task 01 rewrites it"
  - "[code://packages/agent-pi/src/session.ts#L227-L231](../../../../packages/agent-pi/src/session.ts#L227-L231) - `agent_settled`, where plan 01 task 01 records the leaf"
---

## Objective

`piSession` answers `forkPoint(turnId)` with pi's leaf as it was when the turn settled, the same entry `endPoint` answers.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - `forkPoint: (turnId) => ends.get(turnId)` beside `endPoint`, with a comment saying a fork copies through the turn.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. Answer `forkPoint` from the `ends` map plan 01 task 01 adds; no second map.
2. A `!command` turn has no leaf and answers `undefined`.

## Validation

- `test/agent-pi.test.ts`: after a turn settles, `forkPoint('t1')` equals `endPoint('t1')`; a running turn and a turn id this session never watched answer `undefined`, as does a `!command` turn, which is not pi's. A turn seeded from a resumed session's file answers the end the file records, which is what makes a session read from disk able to fork.
- `pnpm test`, `pnpm typecheck` green.
