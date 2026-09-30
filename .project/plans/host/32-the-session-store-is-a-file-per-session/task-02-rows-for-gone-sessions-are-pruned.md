---
title: Rows for gone sessions are pruned
status: todo
depends: [task-01-a-file-per-session.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/sessions.ts#L41-L95](../../../../packages/sdk/src/types/sessions.ts#L41-L95) - the port"
  - "[code://packages/sdk/src/catalog.ts](../../../../packages/sdk/src/catalog.ts) - the catalogue listing"
---

## Objective

`SessionStore` has optional `prune(known: Set<string>)`; after a catalogue listing that every backend answered, the host calls it with every listed and live id, and the file store removes the rest; a listing with a failed backend prunes nothing.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts` - `prune`, documented as optional.
- `UPDATE: packages/sdk/src/sessions.ts` - both stores implement it.
- `UPDATE: packages/sdk/src/host.ts` - the call after a full listing.
- `UPDATE:` the store and host tests.

## Steps

1. Tests first: a stored id no backend lists is removed after a listing; a live session never listed is kept; a backend that throws while listing prunes nothing.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
