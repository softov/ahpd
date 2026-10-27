---
title: Every agent entry has a description
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts) - `descriptors`, which this task changes"
---

## Objective

Each agent entry on the root channel carries a `description`.
A backend that says none is described by its display name.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:165-168` - `descriptors` sends `description` for every agent.

## Steps

1. Send the backend's `description`, or its `displayName` when it says none.

## Validation

- The ACP and cofold cases of p3 and p4 report no missing `description` on the root channel.
- `pnpm typecheck` passes.

## Resume

Done 2026-10-27.
`descriptors` sends the backend's description, or its display name.
The ACP and cofold cases report the missing `description` before this change, and nothing after it.

