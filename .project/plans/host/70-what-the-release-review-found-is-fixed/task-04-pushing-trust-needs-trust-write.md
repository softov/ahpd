---
title: Pushing trust needs trust:write
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/gate.ts#L269-L276](../../../../packages/sdk/src/host/gate.ts#L269-L276) - `dispatchNeeds`"
  - "[code://packages/sdk/src/users.ts#L23-L45](../../../../packages/sdk/src/users.ts#L23-L45) - roles and subjects"
---

## Objective

A `root/configChanged` that carries `workspaceTrust` needs `trust:write`, and the built-in member role has it.

## Files

- `UPDATE: packages/sdk/src/users.ts` - add `trust` to `SUBJECTS` and `trust:write` to `member`.
- `UPDATE: packages/sdk/src/host/gate.ts:269-276` - ask for `trust:write` when the config has `workspaceTrust`.
- `UPDATE: packages/sdk/test/` - the cases below, in the gate tests.

## Steps

1. Add `trust` to `SUBJECTS`.
2. Add `trust:write` to the built-in `member` role.
3. In `dispatchNeeds`, return `trust:write` when the config has `workspaceTrust` and every key is per connection.
4. Keep `undefined` for a config of `defaultShell` alone.

## Validation

- `it('refuses a workspaceTrust push from a role without trust:write')`
- `it('accepts a workspaceTrust push from a member')`
- `it('keeps the trust a connection had when a push is refused')`
- `it('accepts defaultShell alone with no grant')`
- `it('accepts every push on a host with no people directory')`
- Run the full gates from the plan. All pass.

## Resume

