---
title: pi says its state by actions
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - the thinking level, a steer, the running turn and the schema"
  - "[code://packages/agent-pi/src/types.ts](../../../../packages/agent-pi/src/types.ts) - `permissionModeProperty`"
---

## Objective

pi says its thinking level by the field the action declares, a failed steer leaves the turn running, and pi's state carries only declared fields.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:820-829` - the level goes out as `config`.
- `UPDATE: packages/agent-pi/src/session.ts:1381-1420` - a failed steer is logged and taken out, and the turn runs on.
- `UPDATE: packages/agent-pi/src/session.ts:1079` - the running turn carries no `state`.
- `UPDATE: packages/agent-pi/src/session.ts:1203` - the command turn carries no `state`.
- `UPDATE: packages/agent-pi/src/session.ts:611-626` - the schema a session states carries no `scope`.
- `UPDATE: packages/agent-pi/src/types.ts:61` - the permission property carries no `scope`.

## Steps

1. Say `thinking_level_changed` as `session/configChanged` with `config`.
2. Log a steer pi refuses, take it out, and leave the turn running.
3. Remove `state` from the running turns pi builds.
4. Remove `scope` from the properties pi puts in its state.
5. Run pi's suites.

## Validation

- A test of each change fails before it, for the reason the change names, and passes after it.
- `pnpm exec vitest run packages/agent-pi/test` passes.

## Resume

<Empty until started.>
