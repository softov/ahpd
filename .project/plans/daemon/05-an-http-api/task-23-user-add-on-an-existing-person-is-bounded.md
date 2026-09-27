---
title: user add on a person who exists is bounded by the roles they hold, and a role named like an object key is refused
status: todo
depends: [task-17-a-caller-gives-only-what-it-holds.md]
layer: "server, sdk"
refs:
  - "[code://packages/server/src/commands/user.ts#L33-L38](../../../../packages/server/src/commands/user.ts#L33-L38) - `bounded`, which passes a caller with no actor"
  - "[code://packages/server/src/commands/user.ts#L116-L139](../../../../packages/server/src/commands/user.ts#L116-L139) - `user add`, which checks only the roles being given"
  - "[code://packages/sdk/src/users.ts#L313-L331](../../../../packages/sdk/src/users.ts#L313-L331) - `grantsOf`, whose `BUILT_IN[role]` lookup answers for `constructor`"
  - "[code://packages/sdk/src/users.ts#L490-L512](../../../../packages/sdk/src/users.ts#L490-L512) - `add`, which replaces an existing person's roles"
---

## Objective

A `users:write` caller cannot re-add a person whose current roles hold a grant the caller lacks, so it cannot demote an admin and then mint their token; `bounded` does not depend on another check having refused a caller with no actor; and `--role constructor` is refused as an unknown role rather than answered 500.

## Files

- `UPDATE: packages/server/src/commands/user.ts:33-38` - `bounded` runs its check on every surface but `cli`.
- `UPDATE: packages/server/src/commands/user.ts:116-139` - `user add` bounds the person's current grants too.
- `UPDATE: packages/sdk/src/users.ts:313-331,490-512` - own-key lookups.
- `UPDATE: packages/server/test/server-http.test.ts`, `packages/sdk/test/users.test.ts` - the cases below.
- `UPDATE: docs/USERS.md` - the `users` row says a role an issuer grants at sign-in is not in the file, so `user rm` does not see it.

## Steps

1. In `user add`, when `grantsOfPerson(id)` answers, bound it as well as the roles being given.
2. `bounded` returns early only on the `cli` surface or for `ROOT`; a served call with no actor is refused 401 with the sentence `checkScopes` gives.
3. `grantsOf` and `add`'s unknown-role check use `Object.hasOwn` on `file.roles` and `BUILT_IN`.
4. Say in `docs/USERS.md` that the bound counts the roles in the users file, and a role an issuer's claim grants at sign-in is not among them.

## Validation

- `server-http.test.ts`: `pat` (only `users:write`) posting `{"role":["people"]}` to `/api/user/add/ada`, where `ada` is `admin`, answers 403 and `ada`'s roles in the file are unchanged. Today it answers 200.
- `users.test.ts`: `add('x', ['constructor'])` rejects with `no role called constructor`, and `grantsOfRoles(['__proto__'])` is empty. Today the first throws a TypeError.
- `server-commands.test.ts`: `user.add` executed on the `remote` surface with no actor is refused 401.
- `node_modules/.bin/vitest run packages/server/test packages/sdk/test/users.test.ts` green.

## Resume
