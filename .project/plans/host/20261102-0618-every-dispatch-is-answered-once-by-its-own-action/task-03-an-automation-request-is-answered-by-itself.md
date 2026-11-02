---
title: An automation request is answered by itself
status: planned
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - an automation's create, update and removal"
---

## Objective

A create or an update the store took is answered by the client's request, after the store's `automation/set`.
A removal of an automation the store does not hold is answered by the client's removal.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts` - each path says the client's action once the store took it.
- `UPDATE: packages/sdk/test/automations.test.ts` - a create, an update and an unknown removal are each answered with the client's origin.

## Steps

1. After `store.create` or `store.update` took the request, dispatch the request with its origin.
2. Dispatch an unknown removal with its origin.

## Validation

- `pnpm exec vitest run packages/sdk/test/automations.test.ts` - passes; the new cases fail on e4694965.
