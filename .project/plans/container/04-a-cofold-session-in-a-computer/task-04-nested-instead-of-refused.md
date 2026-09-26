---
title: A backend that runs nested is proxied instead of refused
status: implemented
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

Implemented 2026-09-26.
`packages/sdk/src/types/agent.ts` adds `Agent.runsNested`, and `packages/sdk/src/validate.ts` (a departure from the listed files) checks it is a boolean at plugin load, the way every other optional member is.
`packages/sdk/src/host.ts` replaces the backend with `nestedAgent(agent)` at the one place a session starts, when the agent declares `runsNested` and `computerId(config.computer)` names a machine; a session with no machine, or a backend without the flag, is started as before.
`packages/sdk/src/computers.ts` wraps `nested` in `computersFor` with the same `ahpd.agents` check `how` gets, because a nested session enters the machine through `nested` and never through `how`.
`packages/agent-cofold/src/agent.ts` declares `runsNested: true` and no longer calls `refuseComputer`, so a cofold session on a `computer://` is served by a host started in the machine.
Validated by `test/computer-refusal.test.ts`, which still holds every backend without the flag to the refusal and asserts cofold's flag and that it no longer refuses, and by the last case of `test/nested-proxy.test.ts`, where the host gives a `runsNested` backend the proxy and its own `create` is never called.
