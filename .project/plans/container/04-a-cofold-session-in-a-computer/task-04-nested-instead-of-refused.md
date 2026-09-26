---
title: A backend that runs nested is proxied instead of refused
status: todo
depends: [task-03-the-proxy-forwards-the-rest.md]
layer: "sdk | agent-cofold"
refs:
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - `refuseComputer`"
  - "[code://packages/agent-cofold/src/agent.ts#L605](../../../../packages/agent-cofold/src/agent.ts#L605) - where cofold refuses"
---

## Objective

An agent that declares `runsNested: true` is given a `nestedAgent` session when its session has a computer, and cofold declares it and stops refusing.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - `runsNested`.
- `UPDATE: packages/sdk/src/host.ts` - the choice at session start.
- `UPDATE: packages/agent-cofold/src/agent.ts`

## Steps

1. A backend without the flag still refuses as today.

## Validation

- `test/computer-refusal.test.ts` still passes; a new case: cofold with a computer gets the proxy.

## Resume
