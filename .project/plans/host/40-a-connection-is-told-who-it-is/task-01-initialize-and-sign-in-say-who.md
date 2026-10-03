---
title: Initialize and the root snapshot say who the connection is
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4507-L4511](../../../../packages/sdk/src/host.ts#L4507-L4511) - `ownerFor`, reused as the value"
  - "[code://packages/sdk/src/host.ts#L7527-L7660](../../../../packages/sdk/src/host.ts#L7527-L7660) - `initialize` and its `_meta`"
  - "[code://packages/sdk/src/host.ts#L6131-L6150](../../../../packages/sdk/src/host.ts#L6131-L6150) - `rootState(mine, connection)` and its `_meta`"
  - "[code://tools/wire.mjs#L167-L180](../../../../tools/wire.mjs#L167-L180) - which frames the schema gate checks"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the schema gate and its fixture"
---

## Objective

`initialize` and the root state snapshot built for a connection answer `_meta['ahpd.principal']` with `ownerFor(connection)`, and nothing else on the wire changes.

## Files

- `UPDATE: packages/sdk/src/host.ts:7527-7660` - the `_meta` object `initialize` returns gains the key when `ownerFor(connection)` is defined.
- `UPDATE: packages/sdk/src/host.ts:6131-6150` - `rootState`'s `meta` gains the key when it is built for a connection whose `ownerFor` is defined; the shared snapshot built with no connection never carries it.
- `UPDATE: packages/sdk/test/wire.test.ts` - the fixture takes a root snapshot on a personal-token connection, so the key is checked against the schema.
- `CREATE or UPDATE: packages/sdk/test/<the users or auth test that already drives accept and authenticate>` - the cases below.

## Steps

1. In `initialize`, read the connection the handler already has and spread `...(ownerFor(connection) === undefined ? {} : { 'ahpd.principal': ownerFor(connection) })` into the `_meta` it returns, beside `ahpd.resourceProviders`, with a one-line comment saying what a client reads it for.
2. In `rootState`, spread the same key into `meta` when `connection` is given and `ownerFor(connection)` is defined. Check every caller of `rootState` and any replay or cached copy of the snapshot, so one connection's principal never reaches another.
3. `authenticate` is not changed: the protocol declares its result empty.

## Validation

- Tests: a personal-token connection's `initialize` carries `user:<id>`; a root connection's carries `root:<host>`; a host without a users directory carries no key; a root snapshot taken by a connection after it signs in through `authenticate` carries `user:<id>`; two connections as two people each see only their own; `authenticate` still answers `{}`.
- `pnpm exec tsc --noEmit` clean, `pnpm test` passes, `pnpm boundary` clean.

## Resume
