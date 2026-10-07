---
title: trust and proxy are in the operations table
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/users.ts#L111-L173](../../../../packages/sdk/src/users.ts#L111-L173) - `OPERATIONS`"
  - "[code://packages/sdk/src/host/root.ts#L305-L331](../../../../packages/sdk/src/host/root.ts#L305-L331) - `advertisedGrants`"
  - "[code://packages/sdk/test/users-host.test.ts#L369](../../../../packages/sdk/test/users-host.test.ts#L369) - the advertisement test"
---

## Objective

`OPERATIONS` has a `trust` entry and a `proxy` entry, and the host advertises both to a client.

## Files

- `UPDATE: packages/sdk/src/users.ts:111-173` - add `trust` (`push`, write group) and `proxy` (`models` read, `call` write), each with a short title and a one-sentence description.
- `UPDATE: packages/sdk/src/host/root.ts:309` - the comment's subject count.
- `UPDATE: packages/sdk/test/users-host.test.ts` - the cases below.

## Steps

1. Write the tests.
2. Add the two entries.
3. Run `node tools/schema.mjs` and keep what the wire test writes.

## Validation

- `users-host.test.ts`: the advertisement holds `trust` with `push` and `proxy` with `models` and `call`, in the groups above.
- The same file: `grantProblem('trust:push')` and `grantProblem('proxy:call')` answer nothing, and `grantProblem('trust:get')` names the subject's operations.
- An existing gate test still refuses a `workspaceTrust` push from a role without `trust:write`.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume
