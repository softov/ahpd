---
title: The sdk README says how to build a host
status: todo
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/README.md](../../../../packages/sdk/README.md) - has `Use` and `Options`"
  - "[code://docs/LIBRARY.md](../../../../docs/LIBRARY.md) - the detail the README links to"
---

## Objective

The sdk README shows a host that runs, and explains each option `createHost` takes.

## Files

- `UPDATE: packages/sdk/README.md` - check `Use` runs as written, and check each `Options` row against the type `createHost` takes.

## Steps

1. Read the options type of `createHost` in `packages/sdk/src`.
2. Give each property one row with its default and one sentence on what it does.
3. Remove each row that names a property the type does not have.
4. Run the `Use` example against the built package, and correct it until it starts a host.
5. Link `docs/LIBRARY.md` for each option that needs more than one sentence.

## Validation

- The `Use` example starts a host that a client connects to.
- The type's property names and the `Options` rows are the same set.
- `pnpm build` passes.

## Resume
