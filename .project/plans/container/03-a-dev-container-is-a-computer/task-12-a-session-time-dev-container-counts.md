---
title: A dev container made at session start needs computer:write
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://.project/plans/plugin/16-a-disposable-machine/task-09-a-machine-made-for-a-session-counts.md](../../plugin/16-a-disposable-machine/task-09-a-machine-made-for-a-session-counts.md) - where the count and the grant were built for every source"
  - "[code://packages/sdk/src/host/admission.ts](../../../../packages/sdk/src/host/admission.ts) - `capabilityFor`, which asks `computer:write` of a `createSession` naming a source"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts) - `computerNeeds`, the same for a `session/configChanged`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the `devcontainer://<folder>` session-time create, counted by `roomFor` in the same turn as the make"
---

## Objective

`devcontainer://F` picked for a session is refused to a principal without `computer:write`, as `disposable:<profile>` is.
This applies [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md).

plugin/16 task 09 is in, so the count and the grant already cover every source: `capabilityFor` and `computerNeeds` ask `computer:write` for any `computer` value `computerSource` answers, which is anything but empty or `computer://<id>`, and the plugin's `devcontainer://` create runs `roomFor` in the same turn as the make. What this task adds is the test that says so for a dev container.

## Files

- `UPDATE: packages/sdk/test/users-gate-sessions.test.ts` - the case below.

## Steps

1. Check what is already covered: the `max` count for `devcontainer://F` is `computer-devcontainer.test.ts`'s "counts a machine made for a session against max, as one made from the form is"; the grant is asserted only for `disposable:s`.
2. Assert the grant for `devcontainer://F`.

## Validation

- A principal holding `session:write` and not `computer:write` is refused `createSession` with `computer: devcontainer:///w/app`, and a `session/configChanged` to the same, with `w may not computer:write here`.

## Resume

Not started on 2026-10-03, waiting on plugin/16 task 09.

Cut and implemented on 2026-10-05, after plugin/16 landed on main.

What was already covered, and so is not this task's any more: `roomFor` in the plugin's `devcontainer://` create, tested with `max: 1` by "counts a machine made for a session against max, as one made from the form is" in `packages/computer/test/computer-devcontainer.test.ts`; and the `computer:write` gate itself, which `capabilityFor` (`packages/sdk/src/host/admission.ts`) and `computerNeeds` (`packages/sdk/src/host/gate.ts`) apply to any source `computerSource` answers, `devcontainer://` included. No code changed.

Files changed:

- `packages/sdk/test/users-gate-sessions.test.ts` - "needs computer:write to name a folder's dev container for a session": `createSession` and `session/configChanged` naming `devcontainer:///w/app` are both refused to a principal without `computer:write`.

The case passes without a code change, because the gate already covered the source; it is a test of what plugin/16 built rather than a fix, so there is no failing run before it.
