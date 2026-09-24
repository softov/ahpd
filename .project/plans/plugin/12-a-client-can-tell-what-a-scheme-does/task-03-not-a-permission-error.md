---
title: A scheme nobody serves is not a permission error
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/host.ts#L4604-L4608](../../../../packages/sdk/src/host.ts#L4604-L4608) - `storeFor`, where the scheme is resolved"
  - "[code://packages/sdk/src/resources.ts#L45-L60](../../../../packages/sdk/src/resources.ts#L45-L60) - `why`, the sentence to keep"
  - "[code://test/uri-resources.test.ts#L84-L93](../../../../test/uri-resources.test.ts#L84-L93) - the case that pins `-32009`"
  - "[code://.project/decisions/a-scheme-nobody-serves-is-not-a-permission-error.md](../../../decisions/a-scheme-nobody-serves-is-not-a-permission-error.md) - the decision"
---

## Objective

A resource command naming a non-`file:` scheme no provider serves is refused `-32601` by the host, with the sentence naming the scheme and the client case, before the file store is asked.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the routing step: a non-`file:` scheme with no provider throws `-32601` with the sentence, and the file store is reached only for `file:` and a bare path.
- `UPDATE: test/uri-resources.test.ts` - the unregistered-scheme case becomes `-32601` with the same message.
- `UPDATE: test/host.test.ts` or a case beside it - a method a provider lacks is still `-32601`, so the two answers agree.

## Steps

1. Where the store is resolved, refuse a scheme that is neither `file` nor owned by a provider, with `-32601` and the sentence `nothing here serves <scheme>:, and no connected client publishes it`.
2. Keep that sentence in one place, so the file store and the routing step say the same thing rather than two that drift.
3. Leave the client-published route alone: a URI a connected client owns is asked of it first, and a client that has gone away is the case the sentence also covers.
4. Leave `-32009` where it means something: the gate refusing a person's command, and a store refusing a path it does not permit.

## Validation

- `test/uri-resources.test.ts` - `resourceRead` on `notes://local/x` is `-32601` with a message containing `nothing here serves notes:`.
- `test/uri-resources.test.ts` - a provider without `write` still answers `-32601` for one, so the two cases agree.
- `test/host.test.ts` - a role without the grant for a scheme it does serve is still refused `-32009`, which is the case that must not change.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
The code a client branches on is the code, not the sentence; the sentence stays for a person.
