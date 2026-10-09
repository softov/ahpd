---
title: Policy is a Records over the Policies port
status: done
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

`policy.ts` is 151 lines. Gone: `splitFor`, `At`, `moment`, `asFile`, the `description` const, `providerFor` and `bodyOf`, and with them the `RpcError` and `types/resources.js` imports. `PolicyProvider` is now `export type PolicyProvider = RecordsProvider`.

In their place is `records(store): Records` - `ids` as `list().map(id)`, `find` as a copy of `get` (a copy because `Policy` is an interface and one is not assignable to `Record<string, unknown>`; a spread is an object literal and is), `drop` as `remove`, and `put` as `checkPolicy({ ...(was ?? {}), ...body, id })` with the merge comment step 2 asks for moved onto it, extended with the empty-body sentence `bodyOf`'s doc carried. `policyProviders` is `recordsProvider(what, records(store))`.

Step 1's "if people's `line` and `lines` are the same text": they are, word for word including both doc lines, so both moved to `records.ts` and `people.ts` imports them. `TITLE`, `ABOUT`, `enums`, `choice`, `ALL_MEASURES` and `narrowed` stay, which only policy has.

Two things that were checked rather than assumed: the order of refusals is unchanged, because `jsonBody` runs at the `records.put(at.id, jsonBody(content, scheme), was)` call, which is after the provider's `createOnly` check, exactly where `bodyOf(content)` ran before; and `checkPolicy` still receives `was` first and the body over it, so a field the body does not name is still the row's own.

Gates: `pnpm exec tsc -p packages/sdk --noEmit` clean, `npx vitest run packages/sdk --maxWorkers=2 --testTimeout=10000` 124 files and 2421 tests passed, with `policy-scheme.test.ts` (18), `policies.test.ts` (26), `policy-checks.test.ts` (18) and `toolpolicy.test.ts` (1) unchanged and green.
