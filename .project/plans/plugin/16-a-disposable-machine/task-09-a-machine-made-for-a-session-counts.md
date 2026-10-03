---
title: A machine made for a session counts against max and needs computer:write
status: todo
depends: []
layer: "computer | sdk"
refs:
  - "[code://packages/computer/src/plugin.ts#L705-L723](../../../../packages/computer/src/plugin.ts#L705-L723) - the `devcontainer://` create, which calls `made.run` directly"
  - "[code://packages/computer/src/plugin.ts#L762-L774](../../../../packages/computer/src/plugin.ts#L762-L774) - the `disposable:` create, which calls `made.run` directly"
  - "[code://packages/computer/src/provider.ts#L309-L312](../../../../packages/computer/src/provider.ts#L309-L312) - the `max` check a `computer://` write passes"
  - "[code://packages/computer/src/tools.ts#L73-L76](../../../../packages/computer/src/tools.ts#L73-L76) - the same count in `request_disposable_computer`"
  - "[code://packages/sdk/src/host.ts#L7163-L7218](../../../../packages/sdk/src/host.ts#L7163-L7218) - `capabilityFor`, which answers what a method needs at the boundary"
  - "[code://packages/sdk/src/host.ts#L226](../../../../packages/sdk/src/host.ts#L226) - `createSession: 'session:write'` in `NEEDS`"
  - "[code://packages/sdk/src/host.ts#L9545-L9546](../../../../packages/sdk/src/host.ts#L9545-L9546) - the dispatch gate, which asks the strictest of a set of grants"
  - "[code://packages/sdk/src/host.ts#L6875-L6900](../../../../packages/sdk/src/host.ts#L6875-L6900) - `beginAutomation`, which places a session with no connection"
  - "[code://packages/sdk/src/host.ts#L8746-L8751](../../../../packages/sdk/src/host.ts#L8746-L8751) - the `policy/01` check in `createSession`, a separate check from the grant"
  - "[code://packages/sdk/src/host.ts#L4589-L4605](../../../../packages/sdk/src/host.ts#L4589-L4605) - `checked`, which is inert with no principal"
  - "[code://packages/sdk/src/host.ts#L4525-L4526](../../../../packages/sdk/src/host.ts#L4525-L4526) - `principalFor`, the person an owner names"
---

## Objective

A `disposable:<profile>` or `devcontainer://<folder>` machine made when a session starts is counted against `max`, and the request that names the source needs `computer:write` as well as `session:write`, on all three roads: `createSession`, a configuration change before the first turn and an automation's start.
This applies [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md).
The `policy/01` computer rows are a separate check and do not stand in for the grant; for now they also run on the pre-turn change and the automation's start, with the same kinds as `createSession`.
An automation's start acts as its owner through `principalFor(owner)`, and is refused a source when that owner has not signed in since the daemon started.

## Files

- `UPDATE: packages/computer/src/provider.ts:309-312` - the count becomes one exported function that lists the runtime's machines and answers the `max` sentence when one more would pass it; the provider calls it.
- `UPDATE: packages/computer/src/tools.ts:73-76` - the tool calls it and keeps its own returned sentence shape.
- `UPDATE: packages/computer/src/plugin.ts:705-723`, `:762-774` - both session-time creates call it before `made.run`, and throw its sentence.
- `UPDATE: packages/sdk/src/host.ts:7163-7218` - `capabilityFor('createSession', params)` answers `['session:write', 'computer:write']` when `computerSource(params.config?.computer)` names a source, so the boundary refuses with `refusalReason`.
- `UPDATE: packages/sdk/src/host.ts:9545-9546` - a `session/configChanged` whose `computer` names a source adds `computer:write` to the set the dispatch gate asks.
- `UPDATE: packages/sdk/src/host.ts:6875-6900` - `beginAutomation` reads its principal once as `principalFor(owner)`; when the session names a source and the host has a users directory, an unknown principal is refused with a sentence saying the owner has not signed in since the daemon started, and a known one is checked for `computer:write`, before `placedIn`.
- `UPDATE: packages/sdk/src/host.ts:8746-8751` - the `policy/01` kinds `createSession` asks become one function, `machineChecked(principal, scope, provider, config)`, which `createSession`, the pre-turn change of `computer` (`host.ts:10436-10460`) and `beginAutomation` all call; the pre-turn change undoes its keys on a refusal as `plugin/15` task 11 does.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`, `packages/computer/test/computer-devcontainer.test.ts`, `packages/sdk/test/users-gate.test.ts` - the cases below.

## Steps

1. One function counts the plugin's machines and refuses past `max`; the three roads that make a machine call it.
2. The grant is asked at the boundary, where every other grant is, so the staleness test in `packages/sdk/test/users-gate.test.ts` still classifies `createSession`.
3. A host with no users directory, and a root connection, are not gated, as everywhere else.
4. The policy check runs on all three roads through `machineChecked`, before `plugin/15` task 11's label check, so which kinds are asked and on which roads is one function to change.
5. The automation's principal is read in one place on its road, so a later change of who an automation acts as touches that line only.

## Validation

- With `max: 1` and one machine held, a session picking `disposable:s` is refused with the `max` sentence; today a second machine is made.
- The same for `devcontainer://<folder>`, which `container/03` task 12 relies on.
- A principal with `session:write` and no `computer:write` is refused `createSession` with `disposable:s`, and refused a pre-turn change to it; today both are allowed.
- The same principal may still create a session on this host or on a `computer://<id>` that exists.
- An automation whose owner lacks `computer:write` is refused a `disposable:s` start; one whose owner has not signed in since the daemon started is refused with that sentence; one whose owner has the grant starts.
- A `policy/01` row refusing `disposable:s` refuses it on a pre-turn change and on an automation's start, as on `createSession`; today only `createSession` is refused.

## Resume
