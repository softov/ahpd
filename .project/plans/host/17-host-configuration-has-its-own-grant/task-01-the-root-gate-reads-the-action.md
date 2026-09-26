---
title: The root gate reads the action
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L271-L281](../../../../packages/sdk/src/host.ts#L271-L281) - `dispatchNeeds`"
  - "[code://packages/sdk/src/users.ts#L35](../../../../packages/sdk/src/users.ts#L35) - `SUBJECTS`"
---

## Objective

`root/configChanged` is gated by the keys it sets: `PER_CONNECTION` keys need a sign-in, anything else and `replace` need `config:write`.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `dispatchNeeds(channel, action)` returns `Grant | undefined`; the gate asks for a principal always and for the grant only when there is one.
- `UPDATE: packages/sdk/src/users.ts` - `config` in `SUBJECTS`.
- `UPDATE: test/users-gate.test.ts` - classification and behaviour cases.
- `UPDATE: docs/USERS.md` - the `config` subject and the root rule.

## Steps

1. `dispatchNeeds` reads the root action.
2. The gate skips `can` when nothing is needed, after the principal and standing checks.
3. Tests and docs.

## Validation

- `test/users-gate.test.ts`, 20 cases green.
- Full suite, typecheck and boundary green.

## Resume

Done 2026-09-25. The test helper's `can` matches grants literally, so the admin case there holds `config:write` rather than `*:*`; `holds` in `users.ts` covers `*:*` and `*:write` for any subject.
