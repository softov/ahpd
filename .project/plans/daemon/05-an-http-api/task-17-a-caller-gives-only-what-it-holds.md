---
title: A user command gives, mints for and removes only what its caller holds
status: done
depends: [task-09-the-grants-each-command-needs.md]
layer: "server, sdk"
refs:
  - "[code://packages/server/src/commands/user.ts#L119-L191](../../../../packages/server/src/commands/user.ts#L119-L191) - `user add`, `user rm` and `user token`, each held to what its caller holds"
  - "[code://packages/sdk/src/users.ts#L316-L335](../../../../packages/sdk/src/users.ts#L316-L335) - `grantsOf`, role names resolved to grants, built-in and file-defined"
  - "[code://packages/sdk/src/users.ts#L53-L59](../../../../packages/sdk/src/users.ts#L53-L59) - `holds`"
  - "[code://packages/server/src/commands/scopes.ts#L34-L45](../../../../packages/server/src/commands/scopes.ts#L34-L45) - `checkScopes`, the 403 with `refusalReason`"
  - "[code://packages/server/src/commands/authorize.ts#L28-L36](../../../../packages/server/src/commands/authorize.ts#L28-L36) - `ROOT` and `isRoot`"
---

## Objective

Over HTTP, a caller holding `users:write` but not `*:*` cannot give a role, mint a token for a person, or remove a person, when that role or person holds a grant the caller lacks, per decision [a-caller-gives-only-the-grants-it-holds](../../../decisions/a-caller-gives-only-the-grants-it-holds.md).

## Files

- `UPDATE: packages/sdk/src/users.ts` - the directory answers the grants a set of role names resolves to, and the grants a person's roles resolve to (a method on `Users` beside `add`, `remove`, `mint`, reusing `grantsOf`).
- `UPDATE: packages/server/src/commands/user.ts:119-191` - `add`, `rm` and `token` check the caller against those grants before they write.
- `UPDATE: packages/server/test/server-http.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/users.test.ts` - the resolution.

## Steps

1. Add to the directory a way to resolve role names to grants and a person to grants, from the same file and built-ins `grantsOf` reads; a role that resolves to nothing gives no grant.
2. In `user add`, `user token` and `user rm`, when the caller is a person (the actor is present and not `ROOT`), find the first grant in the target set the caller's `can` refuses, and throw the 403 `checkScopes` throws for it, with `refusalReason(actor.id, grant)`.
3. The terminal's process owner and the deployment token are not bounded: on the `cli` surface and for `ROOT` the check does not run.
4. `user add` for a person who does not exist yet checks only the roles being given; `user token` and `user rm` for a person who does not exist keep today's answer.
5. Do not change `user list`.

## Validation

- `packages/server/test/server-http.test.ts`, with a users file defining a role `people` holding only `users:write`, and a person `pat` with it:
  - `POST /api/user/add/eve {"role":["admin"]}` as `pat` answers 403 naming `*:*`, and eve is not in the file.
  - `POST /api/user/add/eve {"role":["people"]}` as `pat` answers 200.
  - With an `admin` person `ada`, `POST /api/user/token/ada` as `pat` answers 403 and `ada`'s old token still signs in; `POST /api/user/rm/ada` as `pat` answers 403 and `ada` is still in the file.
  - The same three requests with the deployment token answer 200.
  - Today the first and third answer 200, so the case fails.
- `packages/sdk/test/users.test.ts`: the resolution gives `*:*` for `admin`, the file's grants for a defined role, and nothing for an unknown name.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts packages/sdk/test/users.test.ts` green.

## Resume

Seen to fail: `server-http.test.ts`, "refuses a caller the roles and people it does not hold", answered 200 where it wanted 403, and `users.test.ts`, "resolves role names to grants, and a person to the grants its roles hold", failed with `users.grantsOfRoles is not a function`. Both pass after the change.

Done: `Users` gains `grantsOfRoles(roles)` and `grantsOfPerson(id)`, declared in `packages/sdk/src/types/users.ts` and implemented over the directory's own `grantsOf`, which now takes role names rather than a record so both methods reuse it; `user add` checks the roles being given and `user token` and `user rm` check the person's roles, each throwing the 403 `refusalReason` gives for the first grant the caller lacks. A name that resolves to nothing gives no grant, and a person who does not exist is left to the verb's own answer.

Files in this task did not name `packages/sdk/src/types/users.ts`, which the interface addition needed.

Review 2026-09-26: not passed. `user add` on a person who exists replaces their roles and checks only the new ones, so `pat` re-added the admin `ada` as `people` (200), and then minted her token (200). Task 23 bounds the person's current grants too.
