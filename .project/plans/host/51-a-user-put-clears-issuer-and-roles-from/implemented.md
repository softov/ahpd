---
title: A user put clears its issuer and roles-from when it says null - implemented
---

## What exists

- A `user://<id>` put with `issuer: null` or `rolesFrom: null` removes that field from the record; a key left out, or a blank string, keeps what the record had; clearing one does not clear the other (`packages/sdk/src/people.ts`).
- The manifest marks `issuer` and `rolesFrom` `nullable`, and says `null` takes each away.
- `Users.add` takes `issuer` and `rolesFrom` as `string | null`; the file's `add` checks an issuer only when one is given and deletes the field on `null` (`packages/sdk/src/users.ts`).
- `docs/USERS.md` says `null` takes `issuer`, `rolesFrom` and `primary` away.

## Verified

- `packages/sdk/test/people.test.ts`: clearing each field, keeping both when neither is named, a blank string keeping the value, a new person with `issuer: null`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2672 tests) pass on `adb5e00`.

## Departures

- The wire fixture's `user:` manifest records the two `nullable` flags.
