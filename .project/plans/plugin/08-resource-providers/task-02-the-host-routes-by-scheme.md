---
title: The host routes a resource command by scheme
status: done
depends:
  - task-01-a-plugin-contributes-a-provider.md
layer: host
refs:
  - code://packages/sdk/src/host.ts#L5024-L5041 - `resourceList` and `resourceRead`, the first two to route
  - code://packages/sdk/src/host.ts#L5183-L5215 - `createResourceWatch`, which needs `watch` and the same routing
  - code://packages/sdk/src/host.ts#L5225-L5290 - the write half, where an absent method already answers `-32601`
  - code://packages/sdk/src/host.ts#L5419 - `resourceResolve`
  - code://packages/sdk/src/host.ts#L4726-L4745 - the `@` completion, which stays on the file store
  - code://packages/sdk/src/host.ts#L7160-L7194 - the client relay, which must stay ahead of all of this
  - code://packages/sdk/src/resources.ts#L48-L58 - `why`, the sentence an unserved scheme gets
  - code://test/host.test.ts#L3297-L3303 - the resource suite's `at(base)` helper, the pattern for the new cases
---

## Objective

Every resource command reaches the store or provider that owns the URI's scheme, an unserved scheme answers the sentence `why` already writes, and a move or copy whose two ends are different schemes is refused `-32602`.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one helper beside the handlers, `storeFor(uri)`, returning the `file:` store, a registered provider, or `undefined`; the nine call sites route through it and ask for each method with `need(method, name)` so an absent one is `-32601`.
- `UPDATE: packages/sdk/src/host.ts:5419` - `resourceResolve` loses its direct `options.resources` call.
- `UPDATE: packages/sdk/src/host.ts:5183` - `createResourceWatch` resolves the provider first, then asks it for `watch`.
- `UPDATE: packages/sdk/src/host.ts:5225-5290` - the write half gains the routing and the cross-scheme refusal; `resourceMove` and `resourceCopy` compare the two ends' schemes.
- `UPDATE: packages/sdk/src/host.ts:4726-4745` - the `@` completion keeps `options.resources`, with a comment saying why (decision 2).
- `CREATE: test/uri-resources.test.ts` - the routing cases, driven through a host built with one registered provider.

## Steps

1. Write `storeFor(uri)`: strip the scheme with the same expression `why` uses, return `options.resources` for `file`, the record's entry for anything else, and `undefined` for an unregistered scheme.
2. Route the two handlers that name the store today, then the other three resource handlers, then the write half. Each call names its method through `need`, so a provider without `list` answers `-32601` rather than throwing.
3. Leave `resourceRead` asking `options.changes?.read?.(uri)` first, unchanged, and say in the comment that the changeset is asked before the scheme.
4. Refuse `resourceMove` and `resourceCopy` with `-32602` when `storeFor(source) !== storeFor(destination)`, and say why in the message: neither end can carry it out, the same answer two different clients already get.
5. Add the cases: a `file:` read still works with a provider registered; a `computer:` read reaches the provider; an unregistered scheme answers with the `why` sentence; a provider with no `list` answers `-32601` for `resourceList`; a cross-scheme move is refused; a client-published URI is still relayed rather than routed to a provider.
6. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/uri-resources.test.ts` - the six cases in step 5.
- `test/host.test.ts` - the existing filesystem suite unchanged, which is the proof that `file:` did not move.
- `test/clients.test.ts` - the client-published relay unchanged, which is the proof that precedence did not move.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-22.
`storeFor(uri)` answers the file store for `file:` and for a scheme nobody serves, and the registered provider otherwise, so an unregistered scheme keeps the sentence `fileResources` already writes.
Every routed handler asks for its method through `need`, so a provider that leaves one out answers `-32601`; `resourceMove` and `resourceCopy` compare the two ends and refuse `-32602` across schemes.
Found: the union return type flowed through `need(...).watch.call(store, ...)` in `createResourceWatch` with no cast, so the factory needed only the store lookup and nothing else.
