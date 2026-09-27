---
title: user add on a person who exists is bounded by the roles they hold, and a role named like an object key is refused
status: implemented
depends: [task-17-a-caller-gives-only-what-it-holds.md]
layer: "server, sdk"
refs:
  - "[code://packages/server/src/commands/user.ts#L34-L41](../../../../packages/server/src/commands/user.ts#L34-L41) - `bounded`, which passes a caller with no actor"
  - "[code://packages/server/src/commands/user.ts#L119-L145](../../../../packages/server/src/commands/user.ts#L119-L145) - `user add`, which checks only the roles being given"
  - "[code://packages/sdk/src/users.ts#L317-L335](../../../../packages/sdk/src/users.ts#L317-L335) - `grantsOf`, whose `BUILT_IN[role]` lookup answers for `constructor`"
  - "[code://packages/sdk/src/users.ts#L494-L516](../../../../packages/sdk/src/users.ts#L494-L516) - `add`, which replaces an existing person's roles"
---

## Objective

A `users:write` caller cannot re-add a person whose current roles hold a grant the caller lacks, so it cannot demote an admin and then mint their token; `bounded` does not depend on another check having refused a caller with no actor; and `--role constructor` is refused as an unknown role rather than answered 500.

## Files

- `UPDATE: packages/server/src/commands/user.ts:34-41` - `bounded` runs its check on every surface but `cli`.
- `UPDATE: packages/server/src/commands/user.ts:119-145` - `user add` bounds the person's current grants too.
- `UPDATE: packages/sdk/src/users.ts:317-335,494-516` - own-key lookups.
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

Implemented 2026-09-27. Tests first, each seen to fail:

- `server-http.test.ts`, in "refuses a caller the roles and people it does not hold": `pat` posting `{"role":["people"]}` to `/api/user/add/ada` answered 200 (`expected 200 to be 403`). It now answers 403 with `pat may not *:* here`, and `ada` still resolves to `*:*`.
- `users.test.ts`: `add('x', ['constructor'])` resolved rather than rejecting, not the TypeError this Validation predicted: `BUILT_IN['constructor']` is `Object`, so the unknown-role check passed it; the TypeError would come later, when `grantsOf` iterates it. It now rejects with `no role called constructor`, and `grantsOfRoles(['__proto__'])` and `grantsOfRoles(['constructor', 'toString'])` are empty.
- `server-commands.test.ts`: the registry's own hook already refuses a served call with no actor, so a case through `cliRegistry()` passes before and after. The case builds a registry whose `authorize` hook lets everything through and declares only `user`; `user.add` on the `remote` surface with no actor resolved and added `eve`, and now rejects with status 401. (A registry built with no hook at all refuses a scoped command itself, with cofold's `AuthorizationError`.)

`bounded` returns early only on the `cli` surface or for root, and refuses a served call with no actor with `SIGN_IN`. `user add` bounds the person's current grants beside the roles given. `users.ts` reads roles through `roleIn`, which answers only a table's own keys. `docs/USERS.md`'s `users` row says re-adding counts the held roles and that an issuer's sign-in roles are not in the file.

Not changed, and outside this task: a users file whose `roles` has a key `__proto__` is read into a plain object, so that role sets the object's prototype rather than becoming a role, and `roleIn` then answers nothing for it.
