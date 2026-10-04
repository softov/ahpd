---
title: A null issuer or roles-from is taken away
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/people.ts#L158-L191](../../../../packages/sdk/src/people.ts#L158-L191) - the manifest and `put`"
  - "[code://packages/sdk/src/users.ts#L714-L800](../../../../packages/sdk/src/users.ts#L714-L800) - the file's `add`"
---

## Objective

A `user://<id>` put with `issuer: null` or `rolesFrom: null` leaves the record without that field; a put that leaves the key out keeps it.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:272-284` - `Users.add` options take `issuer?: string | null` and `rolesFrom?: string | null`; the comment says `null` takes each away, as it does `primary`.
- `UPDATE: packages/sdk/src/users.ts:714-800` - `add` checks `knows(issuer)` only for a string, sets each field only for a string, and deletes `held.issuer` / `held.rolesFrom` on `null`, beside the `primary === null` delete.
- `UPDATE: packages/sdk/src/people.ts:158-191` - the `issuer` and `rolesFrom` manifest entries get `nullable: true` and a sentence saying `null` takes it away; `put` reads `body.issuer === null ? null : textOf(body, 'issuer')`, and the same for `rolesFrom`, as `primary` does.
- `UPDATE: packages/sdk/test/people.test.ts` - the cases below.
- `UPDATE: docs/USERS.md` - the `user` scheme's write says `null` clears `issuer`, `rolesFrom` and `primary`.

## Steps

1. Failing first: the cases under Validation.
2. The port type, the file's `add`, then `people.ts`.

## Validation

- `packages/sdk/test/people.test.ts`: a person with `issuer` and `rolesFrom` set; a put with `issuer: null` leaves no `issuer` and keeps `rolesFrom`; a put with `rolesFrom: null` leaves no `rolesFrom`; a put naming neither keeps both; a put with `issuer: ''` keeps it (blank is not `null`); a put naming a new person with `issuer: null` writes no `issuer`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, full `pnpm test`.

## Resume
