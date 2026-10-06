---
title: Policy is a Records over the Policies port
status: todo
depends: [task-02-the-record-store-provider-is-its-own-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/policy.ts#L43-L72](../../../../packages/sdk/src/policy.ts#L43-L72) - `splitFor`, `moment`, `line`, `lines`, `asFile`"
  - "[code://packages/sdk/src/policy.ts#L74-L116](../../../../packages/sdk/src/policy.ts#L74-L116) - the title, description and manifest, which stay"
  - "[code://packages/sdk/src/policy.ts#L119-L193](../../../../packages/sdk/src/policy.ts#L119-L193) - `providerFor`, which goes"
  - "[code://packages/sdk/src/policy.ts#L202-L215](../../../../packages/sdk/src/policy.ts#L202-L215) - `bodyOf`, which goes"
  - "[code://packages/sdk/src/policy.ts#L224](../../../../packages/sdk/src/policy.ts#L224) - `policyProviders`, which stays"
  - "[code://packages/sdk/test/policy-scheme.test.ts](../../../../packages/sdk/test/policy-scheme.test.ts) - the scheme's cases"
---

## Objective

`policy.ts` is a `Records` adapter over `Policies` plus its manifest, and `policyProviders` answers `recordsProvider('policy', records)`.

## Files

- `UPDATE: packages/sdk/src/policy.ts` - `splitFor`, `At`, `moment`, `asFile`, `providerFor` and `bodyOf` removed; a `records(store)` with `ids` as `list().map(id)`, `find` as `get`, `put(id, body, was)` as `store.put(checkPolicy({ ...(was ?? {}), ...body, id }))`, `drop` as `remove`.
- `UPDATE: packages/sdk/src/policy.ts` - `PolicyProvider` becomes the shared provider type, still exported under its name.

## Steps

1. Keep `line`, `lines`, `TITLE`, `ABOUT` and `manifest`, which only policy has; if people's `line` and `lines` are the same text, move them to `records.ts` too.
2. The merge comment from `providerFor`'s `write` moves onto `put`.

## Validation

- A pure refactor: `policy-scheme.test.ts`, `policies.test.ts`, `policy-checks.test.ts` and `toolpolicy.test.ts` stay green unchanged, the refusal sentences included.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
