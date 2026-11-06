---
title: x-ahpd/me answers who the connection is
status: done
depends: [task-01-the-principal-keeps-the-sign-in-roles.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/access/tokens.ts#L55-L120](../../../../packages/sdk/src/access/tokens.ts#L55-L120) - `tokenMethods`, the pattern for a method that answers about its caller"
  - "[code://packages/sdk/src/types/plugin.ts#L482-L506](../../../../packages/sdk/src/types/plugin.ts#L482-L506) - `PluginMethod`"
  - "[code://packages/sdk/src/access/users.ts#L1091-L1110](../../../../packages/sdk/src/access/users.ts#L1091-L1110) - how `can` narrows a minted token to its grants"
  - "[code://packages/sdk/src/usage/scopes.ts#L123-L129](../../../../packages/sdk/src/usage/scopes.ts#L123-L129) - `poolsFor`"
  - "[code://packages/sdk/src/index.ts#L93](../../../../packages/sdk/src/index.ts#L93) - where `tokenMethods` is exported"
  - "[code://packages/sdk/src/index.ts#L124](../../../../packages/sdk/src/index.ts#L124) - where the user types are exported"
  - "[code://packages/server/src/commands/run.ts#L1267-L1277](../../../../packages/server/src/commands/run.ts#L1267-L1277) - where the daemon registers the token methods"
  - "[code://packages/sdk/test/token-methods.test.ts](../../../../packages/sdk/test/token-methods.test.ts) - the tests to copy the shape of"
---

## Objective

A client sends `x-ahpd/me` and gets one `Me` object about its own connection.
The object holds the fields of the plan's *Answers* table, for a person and for root.

## Files

- `UPDATE: packages/sdk/src/types/users.ts` - add the `Me` interface, with a comment on each field.
- `CREATE: packages/sdk/src/access/me.ts` - `meMethods(directory, hostName)`, which answers `x-ahpd/me`.
- `UPDATE: packages/sdk/src/index.ts:93` - export `meMethods`.
- `UPDATE: packages/sdk/src/index.ts:124` - export the `Me` type.
- `UPDATE: packages/server/src/commands/run.ts:1267-1277` - register `x-ahpd/me` when the daemon has a users directory.
- `CREATE: packages/sdk/test/me-method.test.ts` - the tests of the method.

## Steps

1. Write the tests first.
2. Add `Me` to `types/users.ts` with the fields of the plan's *Answers* table.
3. Give the method the grant `user:get`, and a `describe` with a short title and one sentence.
4. In `authorize`, let in every reader, a minted token too.
5. For a reader, answer `principal` as `user:<id>`, `kind` as `user`, and the reader's `id`, `roles` and `rolesFromSignIn`.
6. For a reader, resolve `grants` from `roles` with `grantsOfRoles`.
7. For a reader with `token`, narrow `grants` to the token record's `grants`, as `can` does.
8. For a reader, answer `token`, `memberships`, `primary` and `poolsFor(reader)`.
9. For a reader, answer the record's `issuer` and `rolesFrom` when the record has them.
10. For the `root:<host>` owner, answer `kind` `root`, `roles` empty, `grants` `['*:*']` and `pools` `['root:<host>']`.
11. Refuse a connection with no reader and no root owner with `-32007`.
12. Export `meMethods` and the `Me` type from `index.ts`.
13. Register the method in `run.ts` as `{ by: 'ahpd', name, method }`, beside the token methods.
14. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `me-method.test.ts`: a `member` without `user:get` gets their own `Me`.
- `me-method.test.ts`: a sign-in with `rolesFrom` gets the claim's roles in `rolesFromSignIn`, and their grants in `grants`.
- `me-method.test.ts`: a minted token with `grants: ['session:list']` gets only that grant, and its id in `token`.
- `me-method.test.ts`: a person in a team gets `user:<id>` and `team:<name>` in `pools`.
- `me-method.test.ts`: the root owner gets `root:<host>`, `['*:*']` and `['root:<host>']`.
- `me-method.test.ts`: the method refuses a connection that names nobody with `-32007`.
- A test: the handshake lists `x-ahpd/me` under `_meta['ahpd.methods']`.
- `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s test` pass.

## Resume

- **Done so far:** steps 1 to 13. `meMethods(directory)` answers `x-ahpd/me`, and `run.ts` registers it beside the token methods.
- **Next action:** review by Softov.
- **Open questions:** none.
