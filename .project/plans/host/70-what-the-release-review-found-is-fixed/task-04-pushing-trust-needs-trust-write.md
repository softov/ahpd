---
title: Pushing trust needs trust:write
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/gate.ts#L271-L280](../../../../packages/sdk/src/host/gate.ts#L271-L280) - `dispatchNeeds`"
  - "[code://packages/sdk/src/users.ts#L23-L62](../../../../packages/sdk/src/users.ts#L23-L62) - roles and subjects"
---

## Objective

A `root/configChanged` that carries `workspaceTrust` needs `trust:write`, and the built-in member role has it.

## Files

- `UPDATE: packages/sdk/src/users.ts:23-62` - `trust` joins `SUBJECTS`, and `member` gains `trust:write`.
- `UPDATE: packages/sdk/src/host/gate.ts:271-280` - ask for `trust:write` when the config has `workspaceTrust`.
- `UPDATE: packages/sdk/test/users-gate-dispatch.test.ts` - the cases below, beside the root config pushes.
- `UPDATE: docs/USERS.md:390-403` - the `trust` row, which the page's own test asks for.

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

- **Implemented** 2026-10-07 on `build/agents/4f2c8f8e`.
- `users.ts`: `trust` is the last entry of `SUBJECTS`, with the decision named beside it, and `member` holds `trust:write` after `proxy:write`. A role this install writes may name `trust:write` as it may name any other grant.
- `gate.ts`: `dispatchNeeds` reads the config's keys once. A key that is not per connection is still `config:change`; a per-connection config that carries `workspaceTrust` is `trust:write`; `defaultShell` alone is still `undefined`. The comment above it says which key is not the person's own to push.
- `users-gate-dispatch.test.ts`: the five cases. The two refusals fail without the fix. The other three hold it in place. A shell preference is still pushed with no grant, and a host with no people directory still refuses nothing.
- `docs/USERS.md`: the `trust` row in the second grants table, which `users.test.ts` asks for the moment `trust` is a subject. The lead-in says it is one grant and no scheme. The member row, the sample `user list` and the trust section are task 08's.
- **Found and left alone:** the gate asks `trust:write` and `ahpd.grants` carries no `trust`, because the plan adds the subject to `SUBJECTS` and not to `OPERATIONS`. A role editor drawn from that map offers no `trust` line, so a role is given the grant by hand. Recorded as a defaulted row in the plan.
