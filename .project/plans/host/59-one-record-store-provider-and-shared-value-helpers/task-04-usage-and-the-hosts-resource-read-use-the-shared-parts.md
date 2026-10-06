---
title: Usage and the host's resource read use the shared parts
status: todo
depends: [task-02-the-record-store-provider-is-its-own-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/usage.ts#L377-L397](../../../../packages/sdk/src/usage.ts#L377-L397) - `split`, `absent`, `at`"
  - "[code://packages/sdk/src/usage.ts#L546-L549](../../../../packages/sdk/src/usage.ts#L546-L549) - `moment`, the epoch"
  - "[code://packages/sdk/src/usage.ts#L603](../../../../packages/sdk/src/usage.ts#L603) - the read's answer, `asFile` written inline"
  - "[code://packages/sdk/src/host/tooling.ts#L340-L346](../../../../packages/sdk/src/host/tooling.ts#L340-L346) - a read's body decoded by hand"
  - "[code://packages/sdk/test/usage-scheme.test.ts](../../../../packages/sdk/test/usage-scheme.test.ts) - the scheme's cases"
---

## Objective

Usage splits, refuses and answers through `records.ts`'s parts, keeping its pool decoding and query, and the host's tool read decodes a body with `bodyText`.

## Files

- `UPDATE: packages/sdk/src/usage.ts:377-397` - `split` over `splitResource(uri, 'usage')`, decoding `id` and `leaf` as now and reading `query` as `asked`; `absent` is `absentResource('usage', uri)`.
- `UPDATE: packages/sdk/src/usage.ts:549,603` - `EPOCH` and `asFile`.
- `UPDATE: packages/sdk/src/host/tooling.ts:346` - `bodyText` over the answer's `data` and `encoding`.

## Steps

1. A pool that does not decode is still refused as today; only the scheme and `//` check moves.

## Validation

- A pure refactor: `usage-scheme.test.ts`, `usage.test.ts` and `host-tools.test.ts` stay green unchanged; `records.test.ts` from task 02 covers the parts.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
