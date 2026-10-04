---
title: Operations and their groups are one table, and a grant names either
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/users.ts#L24-L88](../../../../packages/sdk/src/users.ts#L24-L88) - `BUILT_IN`, `SUBJECTS`, `GRANT`, `isGrant`, `LEGACY`, `holds`"
  - "[code://packages/sdk/src/types/users.ts#L21-L37](../../../../packages/sdk/src/types/users.ts#L21-L37) - `Verb` and `Grant`"
  - "[code://packages/sdk/test/users.test.ts](../../../../packages/sdk/test/users.test.ts) - the directory and `holds` cases"
---

## Objective

`users.ts` holds one table of the built-in subjects, each with a title, a description, its operations and its `read` and `write` groups, and `holds` answers a grant on an operation from a held operation, a held group that contains it, or a wildcard.

## Files

- `UPDATE: packages/sdk/src/users.ts:24-88` - `OPERATIONS`, `holds`, `isGrant`.
- `UPDATE: packages/sdk/src/types/users.ts:21-37` - `Grant` becomes `` `${string}:${string}` ``; `Verb` is kept as the group name type and renamed in its comment to say so.
- `UPDATE: packages/sdk/test/users.test.ts` - the cases below.

## Steps

1. Add `OPERATIONS`, keyed by subject, with the operations and groups of task 02's table: `session`, `chat`, `terminal`, `automation`, `file`, `config`, `diagnostics`, `container`. Every operation is in exactly one group of its subject; `diagnostics` has an empty `write` and `container` an empty `read`.
2. `RESOURCE_OPERATIONS` is `file`'s entry: `get`, `list`, `resolve`, `watch` in `read`, and `put`, `delete`, `mkdir`, `move`, `copy`, `request` in `write`. A subject not in `OPERATIONS` (a plugin's scheme, `user`, `team`, `project`, `role`, `policy`, `usage`) reads its operations and groups from it. No subject has an operation named `read` or `write`: those two words are only ever the groups.
3. `holds(held, 'S:op')` is true when `held` has `S:op`, `S:*`, `*:*`, `S:<group of op>`, `*:<group of op>`, or, for `S = chat`, `session:<group of op>`. `holds(held, 'S:read')` asked about a group is true only for `S:read`, `S:*`, `*:read`, `*:*` (and `session:read` for `chat`).
4. `isGrant` takes `subject:*`, `subject:read`, `subject:write`, and `subject:op` where `op` is in the subject's operations; any `[a-z][a-zA-Z]*` operation on a subject not in `OPERATIONS`. `LEGACY` is unchanged. A role already written with `file:read`, `user:write` or any other group keeps meaning the group, so nothing in a `users` file is migrated.
5. `BUILT_IN` is unchanged.

## Validation

- `packages/sdk/test/users.test.ts`: `holds({'session:write'}, 'session:dispose')` and `holds({'session:write'}, 'chat:send')` are true; `holds({'chat:send'}, 'chat:cancel')` is false; `holds({'chat:send'}, 'chat:write')` is false; `holds({'file:read'}, 'computer:list')` is false and `holds({'computer:read'}, 'computer:list')` is true; `holds({'file:read'}, 'file:get')` and `holds({'user:write'}, 'user:put')` are true, `holds({'file:get'}, 'file:read')` and `holds({'user:put'}, 'user:write')` are false; no subject in `OPERATIONS`, `file` included, has an operation `read` or `write`; `isGrant('session:launch')` is false and `isGrant('computer:launch')` is true; every operation in `OPERATIONS` is in one group of its subject and no other.
- `pnpm exec vitest run packages/sdk/test/users.test.ts packages/sdk/test/users-gate.test.ts` passes, the gate unchanged.
- `pnpm exec tsc --noEmit` passes.

## Resume
