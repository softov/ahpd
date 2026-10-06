---
title: A close during create disposes what was made
status: todo
depends: [task-01-a-restart-waits-for-the-old-inner-host.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L761-L768](../../../../packages/sdk/src/nested.ts#L761-L768) - `createSession` inside"
  - "[code://packages/sdk/src/nested.ts#L971-L974](../../../../packages/sdk/src/nested.ts#L971-L974) - `close` disposes only when `ready`"
---

## Objective

A nested session removed while its inner `createSession` is in flight leaves no session inside: the close waits for the create to settle and disposes what it made.

## Files

- `UPDATE: packages/sdk/src/nested.ts:761-768,971-974` - `close` on a removal waits for a create in flight and disposes the session if it was made; today `up` is false until `ready`, so the host is shut down with no dispose and an inner session the create already wrote stays in the machine's store.
- `UPDATE: packages/sdk/test/nested-process.test.ts` - the case below.

## Steps

1. Failing case first: an inner host whose `createSession` answers after a delay; dispose the outer session during it. Today the inner store holds the session afterwards; after, it does not.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume
