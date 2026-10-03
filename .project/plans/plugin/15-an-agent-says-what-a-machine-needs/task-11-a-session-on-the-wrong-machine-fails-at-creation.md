---
title: A session on a machine not prepared for its agent fails at creation
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/computers.ts#L103-L130](../../../../packages/sdk/src/computers.ts#L103-L130) - `computersFor`, whose `prepared` closure is the check, fired only when the backend enters the machine"
  - "[code://packages/sdk/src/host.ts#L8676-L8692](../../../../packages/sdk/src/host.ts#L8676-L8692) - `createSession`: the policy check, then `placedIn`"
  - "[code://packages/sdk/src/host.ts#L10436-L10460](../../../../packages/sdk/src/host.ts#L10436-L10460) - the config change before the first turn, where a refused value is undone and the action refused"
  - "[code://packages/sdk/src/host.ts#L10515-L10517](../../../../packages/sdk/src/host.ts#L10515-L10517) - where that change starts `restart`"
  - "[code://packages/sdk/src/host.ts#L5025-L5135](../../../../packages/sdk/src/host.ts#L5025-L5135) - `restart`"
  - "[code://packages/sdk/src/host.ts#L6875-L6900](../../../../packages/sdk/src/host.ts#L6875-L6900) - `beginAutomation`, which places an automation's session"
  - "[code://packages/sdk/src/host.ts#L3667](../../../../packages/sdk/src/host.ts#L3667) - where `spawn` wraps the port with `computersFor`"
---

## Objective

`createSession`, a configuration change before the first turn and an automation's start read the machine's `ahpd.agents` label and fail with the refusal sentence when the session's agent is not among them, before any backend starts.
This applies [A session on a machine not prepared for its agent fails at creation](../../../decisions/a-session-on-a-machine-not-prepared-for-its-agent-fails-at-creation.md); the port check in `computersFor` stays.

## Files

- `UPDATE: packages/sdk/src/computers.ts:103-130` - `prepared` is lifted out of `computersFor` into one exported reader, `machineRefusal(computers, id, provider)`, which answers the sentence or nothing; `computersFor` calls it.
- `UPDATE: packages/sdk/src/index.ts:40` - the export, beside `computersFor`.
- `UPDATE: packages/sdk/src/host.ts:8676-8692` - `createSession` calls the reader for a `computer://<id>` setting before `placedIn`, and throws the sentence as an `RpcError`.
- `UPDATE: packages/sdk/src/host.ts:10436-10460` - a change of `computer` to a `computer://<id>` calls the reader before `restart` is started; a refusal undoes the keys and refuses the action as the "fixed once the session has started" branch does, so the session keeps running where it was.
- `UPDATE: packages/sdk/src/host.ts:6875-6900` - `beginAutomation` calls the reader before `placedIn`.
- `UPDATE: packages/computer/test/computer-session.test.ts` - the cases below.

## Steps

1. One function answers "may provider X run on machine Y", and the host and `computersFor` both call it, so the sentence is one.
2. A machine with no `ahpd.agents` label is allowed, as today, and a port with no `agents` makes no check.
3. Only a `computer://<id>` is checked: a source is made by `placedIn` with `for: <provider>`, so it is prepared for the session's agent by construction.
4. The config change is an async check inside a branch that answers synchronously today; make the check before the restart's `work` begins, not inside `restart` after the old backend is gone.
5. The policy check runs first and the label check after it, so a person refused a machine by policy is told that; on each road the two calls sit next to each other, so the order is one line to change.

## Validation

- `createSession` with cofold on a machine labelled for Claude only answers an error with the sentence and no session exists; today the session is created and fails later, so the case fails.
- The same through a configuration change before the first turn: the action is refused and the session still runs on its previous computer.
- The same through an automation's start.
- An unlabelled machine is still allowed on all three roads.
- A machine both refused by policy and not prepared for the agent answers the policy's sentence on all three roads.

## Resume
