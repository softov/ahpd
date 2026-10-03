---
title: A connection is told who it is, on initialize and in its root state snapshot
status: accepted
date: 2026-10-03
supersedes: decisions/a-connection-is-told-who-it-is.md
refs:
  - "[code://packages/sdk/src/host.ts#L4507-L4511](../../packages/sdk/src/host.ts#L4507-L4511) - `ownerFor`, the typed reference a connection's work is owned by"
  - "[code://packages/sdk/src/host.ts#L6131-L6150](../../packages/sdk/src/host.ts#L6131-L6150) - `rootState(mine, connection)`, the snapshot built for one connection, and its `_meta`"
  - "[code://packages/sdk/src/host.ts#L7527](../../packages/sdk/src/host.ts#L7527) - `initialize`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AuthenticateResult` is an empty object; `InitializeResult` and `RootState` declare `_meta`
---

## Context

The decision this replaces put the principal on the `authenticate` result as well as on `initialize`.
The protocol's `AuthenticateResult` is an empty object, and the strict schema built from it refuses `_meta`, so the host cannot say it there.
A client that signs in after connecting still has to learn who it became.

## Decision

`initialize` answers `_meta['ahpd.principal']` with the connection's typed reference when it is already somebody: `user:<id>` for a person, `root:<host>` for the deployment's token.
The root state snapshot answers the same key in its `_meta`, for the one connection it is built for, so a client that signs in reads it by taking the root snapshot again.
The value is `ownerFor(connection)`, and the key is absent where that is undefined, including every host with no users directory.
`authenticate` answers `{}` as it does today.

Source: Softov, 2026-10-03, asked "For now, how does a client learn who its connection is signed in as? (0.9.0's AuthenticateResult has no room for it.)": "Initialize + root _meta".

## Consequences

Both places are ones the protocol declares `_meta` on, so the strict schema holds.
The root snapshot is already built per connection, which is where the sign-in flag on an agent is rewritten, so this is one more key there and not a new mechanism.
A client learns a later sign-in only by asking for the root snapshot again; a live root action does not carry it.

## Options

**`_meta` on the authenticate result.** Rejected: the protocol declares the result empty, and the wire gate exists to keep undeclared fields off the wire.
**Initialize only.** Rejected: a client that signs in after connecting would not learn its id until it reconnected.
**Propose `_meta` on `AuthenticateResult` upstream first.** Not chosen: it waits on the protocol for something the root state already allows.
