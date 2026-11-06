---
title: A call adds meta with a header
status: done
depends: [task-01-a-proxy-record-names-its-key.md, task-02-a-key-is-minted-with-meta.md]
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - `UsageBase` gets `meta`"
  - "[code://packages/sdk/src/types/users.ts](../../../../packages/sdk/src/types/users.ts) - `Principal` gets `keyMeta`"
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - `principalOf` reads the live record"
  - "[code://packages/server/src/proxy/caller.ts](../../../../packages/server/src/proxy/caller.ts) - `callerOf` reads the header"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - `chargedAs` and `record`"
---

## Objective

A call made with `X-AHP-Meta: client=pi` writes a record whose `meta` holds the key's meta and `client=pi`.
A malformed header is refused with 400, and no `X-AHP-*` header goes upstream.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:36-63` - adds `meta?: Record<string, string>` to `UsageBase`.
- `UPDATE: packages/sdk/src/types/users.ts:42-151` - adds a `keyMeta` getter to `Principal`: the meta of the key it signed in with.
- `UPDATE: packages/sdk/src/access/users.ts:1019-1169` - `principalOf` defines `keyMeta` from the live token record.
- `UPDATE: packages/server/src/proxy/caller.ts:42-112` - adds `META_HEADER`, parses it with `parseMeta`, and puts the merged meta on a person's caller.
- `UPDATE: packages/server/src/proxy/listener.ts:460-493` - `Charged` gets `meta` from the caller.
- `UPDATE: packages/server/src/proxy/listener.ts:1114-1152` - `record` writes `meta` when it has entries.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - the header, the merge and the refusal.
- `UPDATE: packages/server/test/proxy-policy-usage.test.ts` - the record with meta.
- `UPDATE: docs/server/PROXY.md` - "Who may call" names the header, and "What is recorded" names `meta`.
- `UPDATE: docs/server/USERS.md:37-69` - `token mint --meta`.
- `UPDATE: docs/sdk/USAGE.md:18-33` - "What a record is" names `token` and `meta`.

## Steps

1. Add `meta` to `UsageBase`, and `keyMeta` to `Principal` and `principalOf`.
2. Add `META_HEADER = 'x-ahp-meta'` to the caller.
3. In `callerOf`, parse the header with `parseMeta`, and answer a 400 refusal with its sentence when it throws.
4. Merge the header's entries under the key's entries, so the key's value wins for the same meta key.
5. Refuse the merged meta with 400 when it holds more than 32 entries.
6. Put the merged meta on the person's caller only when it has entries.
7. Carry `meta` through `chargedAs`, and write it in `record`.
8. Check that the listener still drops every `x-ahp-*` header before it calls the provider.
9. Write the tests and the docs.

## Validation

- `proxy-listener.test.ts`: `X-AHP-Meta: a=1,b=2` reaches the record; `X-AHP-Meta: bad` is 400; the provider does not get `X-AHP-Meta`.
- `proxy-policy-usage.test.ts`: a key with `env=prod` and a header with `env=dev,client=pi` writes `{ env: prod, client: pi }`.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

- **Done so far:** `UsageBase.meta?` holds the names the key and the call named, and `Principal.keyMeta` reads the live token record in `principalOf`. `callerOf` reads `x-ahp-meta`, parses it with `parseMeta`, merges the header under the key's `keyMeta` so the key's value wins, and answers a 400 refusal with the sentence when the parse or the 32-entry bound refuses. `Charged.meta` carries it and `record` writes it when it has entries. Every `x-ahp-*` header still stays on the host.
- **Next action:** none; the plan is implemented.
- **Open questions:** none.
- **Watch out for:** the header is read after the scope answer, so a refused scope stays 403 even when the header is also malformed. An empty `X-AHP-Meta` parses to `{}`, so it names no meta rather than a refusal. A session caller carries no `meta`, because only the person branch of `chargedAs` sets it.

Files changed by this task: `packages/sdk/src/types/usage.ts`, `packages/sdk/src/types/users.ts`, `packages/sdk/src/access/users.ts`, `packages/server/src/proxy/caller.ts`, `packages/server/src/proxy/listener.ts`, `packages/server/test/proxy-listener.test.ts`, `packages/server/test/proxy-policy-usage.test.ts`, `docs/server/PROXY.md`, `docs/server/USERS.md`, `docs/sdk/USAGE.md`, `docs/sdk/USERS.md`, `.project/specs/usage.md`.

