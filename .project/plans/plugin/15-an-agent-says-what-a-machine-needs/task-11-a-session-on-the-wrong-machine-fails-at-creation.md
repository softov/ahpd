---
title: A session on a machine not prepared for its agent fails at creation
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/computers.ts#L98-L130](../../../../packages/sdk/src/computers.ts#L98-L130) - `computersFor`, the port check that fires only when the backend enters the machine"
  - "[code://packages/sdk/src/host.ts#L3841-L3900](../../../../packages/sdk/src/host.ts#L3841-L3900) - `restart`, which moves a session before its first turn"
  - "[code://packages/sdk/src/host.ts#L4093](../../../../packages/sdk/src/host.ts#L4093) - `placedIn`"
---

## Objective

`createSession` and a restart before the first turn read the machine's `ahpd.agents` label and fail with the refusal sentence when the session's agent is not among them.
This applies [A session on a machine not prepared for its agent fails at creation](../../../decisions/a-session-on-a-machine-not-prepared-for-its-agent-fails-at-creation.md); the port check in `computersFor` stays.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `createSession` and `restart` ask the computer port which agents a machine was prepared for, through the same reader `computersFor` uses, before the backend is started.
- `UPDATE: packages/sdk/src/computers.ts` - that reader is exported once and used by both.
- `UPDATE: test/computer-refusal.test.ts` - the cases below.

## Steps

1. One function answers "may provider X run on machine Y" and both the host and `computersFor` call it, so the sentence is one.
2. A machine with no `ahpd.agents` label is allowed, as today.

## Validation

- `createSession` with cofold on a machine labelled for Claude only answers an error with the sentence; today the session is created and fails later, so the case fails.
- The same through a pre-turn restart onto that machine.

## Resume
