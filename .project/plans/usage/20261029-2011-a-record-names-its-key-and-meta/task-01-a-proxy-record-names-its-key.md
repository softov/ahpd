---
title: A proxy record names its key
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - `UsageBase` gets `token`"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - `chargedAs` and `record`"
---

## Objective

A proxy record of a call made with a key holds the key's id in `token`.
A call made with the deployment token, a session token or a sign-in that is not a key holds none.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:36-63` - adds `token?: string` to `UsageBase`: the id of the key that made the call.
- `UPDATE: packages/server/src/proxy/listener.ts:460-493` - `Charged` gets `token`, and `chargedAs` sets it from `principal.token` for a person.
- `UPDATE: packages/server/src/proxy/listener.ts:1114-1152` - `record` writes `token` when `Charged` has one.
- `UPDATE: packages/server/test/proxy-policy-usage.test.ts` - the record of a call made with a key.
- `UPDATE: docs/server/PROXY.md:212-219` - "What is recorded" names `token`.

## Steps

1. Add `token` to `UsageBase` with its comment.
2. Add `token` to `Charged`, and give it the value of `caller.principal.token` in `chargedAs`.
3. Write `token` in `record` when `charged.token` has a value.
4. Check that the usage store keeps an unknown field.
5. Add `token` wherever the store copies fields.
6. Write the tests and the docs line.

## Validation

- `proxy-policy-usage.test.ts`: a call made with a minted key writes a record whose `token` is the key's id.
- `proxy-policy-usage.test.ts`: a call made with the deployment token writes a record with no `token`.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

- **Done so far:** `UsageBase.token?` is the id of the key that made a call. `Charged.token` takes `caller.principal.token` for a person in `chargedAs`, and `record` writes it when it has one.
- **Next action:** [task-02-a-key-is-minted-with-meta.md](task-02-a-key-is-minted-with-meta.md).
- **Open questions:** none.
- **Watch out for:** the store appends each entry whole and reads it whole, so neither field needs a copy there. A session call and a root call write no `token`, because `chargedAs` sets it on the person branch alone.

Files changed by this task: `docs/server/PROXY.md`, `packages/sdk/src/types/usage.ts`, `packages/server/src/proxy/listener.ts`, `packages/server/test/proxy-policy-usage.test.ts`.

