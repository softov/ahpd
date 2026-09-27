---
title: A role named __proto__ in the users file is read as a role
status: todo
depends: [task-23-user-add-on-an-existing-person-is-bounded.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/users.ts#L228-L238](../../../../packages/sdk/src/users.ts#L228-L238) - the role table built into `{}` with `roles[name] = kept`"
  - "[code://packages/sdk/src/users.ts#L34-L36](../../../../packages/sdk/src/users.ts#L34-L36) - `roleIn`, which reads only the table's own keys"
  - "[code://packages/sdk/test/users.test.ts#L244-L246](../../../../packages/sdk/test/users.test.ts#L244-L246) - the `constructor` and `__proto__` cases task 23 added"
---

## Objective

A users file whose `roles` names a role `__proto__` gives that role its grants like any other name, and nothing a file names changes the role table's prototype.

## Files

- `UPDATE: packages/sdk/src/users.ts:228-238` - the table the roles are read into.
- `UPDATE: packages/sdk/test/users.test.ts` - the case below.

## Steps

1. Read the roles into a table that has no prototype (`Object.create(null)`), or define each key as an own property, so the assignment for `__proto__` makes a key rather than setting the prototype.
2. Check every other place `users.ts` builds an object keyed by a name from the file (the users by id, a person's roles) the same way, and treat each one alike.
3. Writing the file back still produces the same JSON for a file without such a name.

## Validation

- `users.test.ts`: a file with `"roles": { "__proto__": ["config:read"] }` and a person holding `__proto__`: `grantsOfRoles(['__proto__'])` is `['config:read']`, and the person's grants include it.
  Today it is empty, because the role set the prototype.
- The task 23 cases (`constructor`, `toString`, `__proto__` with no such role) still pass.
- `node_modules/.bin/vitest run packages/sdk/test/users.test.ts` green.

## Resume
