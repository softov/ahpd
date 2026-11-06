---
title: The principal keeps the sign-in's roles
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/users.ts#L40-L125](../../../../packages/sdk/src/types/users.ts#L40-L125) - `Principal`"
  - "[code://packages/sdk/src/access/users.ts#L992-L1060](../../../../packages/sdk/src/access/users.ts#L992-L1060) - `principalOf`, where `fromIssuer` is merged into `roles`"
  - "[code://packages/sdk/test/users-issuer.test.ts#L327-L346](../../../../packages/sdk/test/users-issuer.test.ts#L327-L346) - the tests of a sign-in with `rolesFrom`"
---

## Objective

A principal says which of its roles the sign-in added.
`roles` stays as it is, with the record's roles and the sign-in's roles together.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:40-125` - add the optional `rolesFromSignIn` to `Principal`, with a comment.
- `UPDATE: packages/sdk/src/access/users.ts:992-1060` - stamp `rolesFromSignIn` from `fromIssuer` and freeze it with the literal.
- `UPDATE: packages/sdk/test/users-issuer.test.ts` - test `rolesFromSignIn` for a sign-in with `rolesFrom`.

## Steps

1. Write the tests first.
2. Add `readonly rolesFromSignIn?: readonly string[]` to `Principal`.
3. In `principalOf`, set `rolesFromSignIn` only when `fromIssuer` is not empty.
4. Freeze the list, as `roles` is frozen.
5. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `users-issuer.test.ts`: a sign-in whose claim adds `operators` gets `['operators']` in `rolesFromSignIn`, and `roles` holds it too.
- `users-issuer.test.ts`: a sign-in with a minted secret has no `rolesFromSignIn`.
- `users-issuer.test.ts`: a write to `rolesFromSignIn` throws in strict mode.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s test` pass.

## Resume

- **Done so far:** steps 1 to 4. `principalOf` stamps a frozen `rolesFromSignIn` when the claim added roles.
- **Next action:** review by Softov.
- **Open questions:** none.
