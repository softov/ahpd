---
title: A connection is told who it is, on initialize and on the authenticate that signs it in
status: accepted
date: 2026-10-03
refs:
  - "[code://packages/sdk/src/host.ts#L4507-L4511](../../packages/sdk/src/host.ts#L4507-L4511) - `ownerFor`, the typed reference a connection's work is owned by"
  - "[code://packages/sdk/src/host.ts#L7527](../../packages/sdk/src/host.ts#L7527) - `initialize`"
  - "[code://packages/sdk/src/host.ts#L8310](../../packages/sdk/src/host.ts#L8310) - `authenticate`, where a person signs in"
---

## Context

host/36 lets a signed-in person read their own `user://<id>` without a grant, but nothing tells a client what its id is.
ahpapp's Organization destination marks the person's own record and says what they are on each host, so it needs that id.
A connection is somebody from the start when it arrived on a personal token or the deployment's token, and becomes somebody later when `authenticate` signs a person in.

## Decision

`initialize` answers `_meta['ahpd.principal']` with the connection's typed reference when it is already somebody: `user:<id>` for a person, `root:<host>` for the deployment's token.
The `authenticate` that signs a person in answers the same key with `user:<id>`.
The value is `ownerFor(connection)`, the spelling `_meta.owner` and `_meta.sender` already use, and the key is absent where that is undefined, including every host with no users directory.

Source: Softov, 2026-10-03, asked "The app has no way to know which user it is signed in as on a host. How should the app learn it?": "ahpd says it on initialize".

## Consequences

A client reads one key at the handshake and one at sign-in, and reads the rest of the record from `user://<id>`, which needs no grant.
Roles are not repeated on the wire: the record holds them, and a role change does not leave a stale copy in `_meta`.
A sign-in that expires sends nothing; a client learns it from the next refusal, as it does today.

## Options

**A `user://me` alias the host resolves.** Not chosen: a second URI for one record, and the id is still unknown to the client for a membership or an owner comparison.
**The root state's `_meta`, rewritten per connection.** Not chosen: root state is shared and rewritten only where it has to be; the handshake is already per connection.
