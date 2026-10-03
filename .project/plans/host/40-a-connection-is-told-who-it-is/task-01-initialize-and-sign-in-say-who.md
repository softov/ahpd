---
title: Initialize and sign-in say who the connection is
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4507-L4511](../../../../packages/sdk/src/host.ts#L4507-L4511) - `ownerFor`, reused as the value"
  - "[code://packages/sdk/src/host.ts#L7527-L7660](../../../../packages/sdk/src/host.ts#L7527-L7660) - `initialize` and its `_meta`"
  - "[code://packages/sdk/src/host.ts#L8380-L8415](../../../../packages/sdk/src/host.ts#L8380-L8415) - the person's sign-in, `connection.principal = held`, and its `return {}`"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the schema gate and its fixture"
---

## Objective

`initialize` and the person's own `authenticate` answer `_meta['ahpd.principal']` with `ownerFor(connection)`, and nothing else on the wire changes.

## Files

- `UPDATE: packages/sdk/src/host.ts:7527-7660` - the `_meta` object `initialize` returns gains the key when `ownerFor(connection)` is defined.
- `UPDATE: packages/sdk/src/host.ts:8380-8415` - the return after a person signs in answers `{ _meta: { 'ahpd.principal': ... } }`.
- `UPDATE: packages/sdk/test/wire.test.ts` - the fixture carries a connection on a personal token, so the key is checked against the schema.
- `CREATE or UPDATE: packages/sdk/test/<the users or auth test that already drives accept and authenticate>` - the cases below.

## Steps

1. In `initialize`, read the connection the handler already has and spread `...(ownerFor(connection) === undefined ? {} : { 'ahpd.principal': ownerFor(connection) })` into the `_meta` it returns, beside `ahpd.resourceProviders`, with a one-line comment saying what a client reads it for.
2. In `authenticate`, in the branch for `resource === loginId()` that sets `connection.principal = held`, return the same key with `user:${held.id}`. The root branch at 8371 that returns `{}` for a root connection signing in to the login resource stays as it is: a root connection is told `root:<host>` at the handshake already.
3. Check the protocol schema allows `_meta` on an authenticate result before shipping step 2. If it does not, stop, leave step 2 out and report it, per the plan's second table.

## Validation

- Tests: a personal-token connection's `initialize` carries `user:<id>`; a root connection's carries `root:<host>`; a host without a users directory carries no key; a connection that signs in through `authenticate` is answered the key; an `authenticate` for a backend resource is answered as before.
- `pnpm exec tsc --noEmit` clean, `pnpm test` passes, `pnpm boundary` clean.

## Resume
