---
title: A machine made for a session counts against max and needs computer:write
status: todo
depends: []
layer: "computer | sdk"
refs:
  - "[code://packages/computer/src/plugin.ts#L504-L545](../../../../packages/computer/src/plugin.ts#L504-L545) - the session-time `create`, which calls `made.run` directly"
  - "[code://packages/computer/src/provider.ts#L300-L306](../../../../packages/computer/src/provider.ts#L300-L306) - the `max` check, reached only through the provider"
---

## Objective

A `disposable:<profile>` or `devcontainer://<folder>` machine made when a session starts is counted against `max`, and the session that asks for it needs `computer:write`.
This applies [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md).

## Files

- `UPDATE: packages/computer/src/plugin.ts:504-545` - the session-time create goes through the same `max` check as a provider write.
- `UPDATE: packages/sdk/src/host.ts` - a `createSession` or restart naming a source that makes a machine needs `computer:write` as well as `session:write`, refused with the grant sentence.
- `UPDATE: test/computer-disposable.test.ts`, `test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. One function counts the plugin's machines and refuses past `max`; both roads call it.
2. The grant check sits beside `NEEDS` so the staleness test sees it.

## Validation

- With `max: 1` and one machine held, a session picking `disposable:s` is refused with the `max` sentence; today a second machine is made.
- A principal with `session:write` and no `computer:write` is refused `disposable:s`; today it is allowed.

## Resume
