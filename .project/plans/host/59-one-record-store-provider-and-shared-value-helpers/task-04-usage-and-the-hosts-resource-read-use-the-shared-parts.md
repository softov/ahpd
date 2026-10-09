---
title: Usage and the host's resource read use the shared parts
status: done
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

`usage.ts`'s `split` is now `splitResource(uri, 'usage')` in a try/catch: a URI of another scheme and a pool that does not decode both answer `undefined`, which is what the one caller that wants nothing rather than a refusal (`authorize`) reads. `at` is unchanged and still throws `-32602` with `${uri} is not a usage: URI` - the same sentence `splitResource` uses, so the refusal a client reads is the same as before. The local `interface At` stays (it holds a decoded `pool` and a `URLSearchParams`), so the shared one is imported as `type At as Split`.

`absent` is gone; its four call sites are `absentResource('usage', uri)`. `moment` is gone and the four uses are `EPOCH`; the "usage has no creation time" paragraph moved into `EPOCH`'s doc in `records.ts`, where it now sits with the reason the record directories give the same answer. The two inline read bodies are `asFile(await groupsBody(held, reader))` and `asFile(await body(held))`.

`host/tooling.ts`'s read decodes through `bodyText`: the answer's `encoding` is narrowed to `'base64'` or `'utf-8'` before it is handed over, which is what the write type asks for, and the branch taken is the one that was taken by hand. The plan's line numbers (346) are stale - host 58 moved this to 396-400.

Gates: `pnpm exec tsc -p packages/sdk --noEmit` clean; `usage-scheme.test.ts`, `usage.test.ts` and `host-tools.test.ts` unchanged and green (85 tests).
