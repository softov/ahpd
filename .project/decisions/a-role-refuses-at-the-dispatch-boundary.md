---
title: A role refuses at the dispatch boundary, and never hides root state
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/host.ts#L7170-L7186](../../packages/sdk/src/host.ts#L7170-L7186) - the one place every command passes through, beside the `handshook` check the gate joins"
  - "[code://packages/sdk/src/host.ts#L1378-L1398](../../packages/sdk/src/host.ts#L1378-L1398) - `dispatch`, whose `serverSeq` and replay buffer are one per host and not one per connection"
  - "[code://packages/sdk/src/host.ts#L1171-L1180](../../packages/sdk/src/host.ts#L1171-L1180) - `broadcast`, which sends one envelope to every connection watching a channel"
  - "[code://packages/sdk/src/host.ts#L3750-L3765](../../packages/sdk/src/host.ts#L3750-L3765) - `rootState`, the four keys an unauthenticated connection can already read"
  - "[code://packages/sdk/src/host.ts#L4435-L4445](../../packages/sdk/src/host.ts#L4435-L4445) - `initialize` answering `initialSubscriptions` inline, so the root snapshot ships in the handshake"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpErrorCodes.AuthRequired` (-32007) and `PermissionDenied` (-32009), and the optional `request` on `PermissionDeniedErrorData`
  - "[code://.project/decisions/client-writes-are-served-not-gated.md](../../.project/decisions/client-writes-are-served-not-gated.md) - the gate removed in `host/04`, which this must not reinstate"
---

## Context

A permission can be expressed two ways: refuse what a client asks for, or never tell it the thing is there.
Hiding is the gentler of the two and the one AHP is otherwise built for, since `terminals` and `automations` are already optional keys whose absence removes a feature.

`host/04` is the warning about refusing. It deleted `mayWrite`, `needsWrite` and `connection.grants` because the refusal carried a `resourceRequest` the only real client never sends, so every save ended in a `NoPermissions` dialog with nothing to click.

But hiding cannot be built here. Root state is per host, not per connection: `dispatch` increments one `serverSeq` and pushes one envelope into one shared replay buffer, and `broadcast` hands that same envelope to every connection watching the channel. A filtered snapshot is possible, because `snapshotOf` is already called per connection, but the next `root/agentsChanged` or `root/terminalsChanged` would hand the filtered client the unfiltered truth against sequence numbers it shares with everybody else. Making root state per principal means making `serverSeq` and the replay buffer per connection, which is a change to the centre of the host.

## Decision

Permissions are enforced by refusing a command, in one place: the dispatch boundary where `handlers[request.method]` is resolved, beside the existing `handshook` check.
Root state is not filtered, and no client is served a different view of the host from any other.

Two answers, both the protocol's own:

- No principal on the connection and the method needs one: `-32007` `AuthRequired`, with `data.resources` carrying the advertised record, which is what tells the client to sign in and retry.
- A principal whose roles do not cover the method: `-32009` `PermissionDenied`, with **no** `data.request`. The protocol says that field is omitted "when no specific access grant would resolve the denial", and a role is exactly that: there is nothing to negotiate, and the client is meant to stop rather than retry.

Source: (defaulted: hiding is unbuildable without per-connection sequencing, and the two error codes are the ones the protocol reserves for these two cases).

## Consequences

`host/04`'s own *Under revision 2026-09-22* note says the removal was too wide and that the fix is to scope the gate rather than restore it everywhere. A capability scoped by the URI's scheme is that scoping for the client-command half: a role holding `write` keeps writing `file:` URIs, which is what must not be undone, and reaches a plugin's scheme only when the role names it. The other half of that note, the host tools a session's model invokes, is not on this boundary and is not answered here.

This does not reinstate what `host/04` removed. That gate was a per-resource grant a client was expected to negotiate and could not; this is a per-person capability with nothing to negotiate, and the absent `data.request` is what says so on the wire. A client that reads `PermissionDeniedErrorData` correctly will show a final refusal rather than a retry loop.

A read-only role will still produce the `NoPermissions` dialog in a VS Code window, because that is how its filesystem provider maps `-32009`. That is correct behaviour for a person who may not write, and it is the reason roles are configuration rather than a default.

One gate covers all twenty-nine handlers, so a handler added later is refused by default rather than served by omission. That is the property `needsWrite` did not have when it was called from five places.

`subscribe` is the one handler whose capability depends on its argument, since `ahp-root://` and `ahp-session:/<uuid>` are not the same permission. It needs channel-aware logic inside the gate rather than one entry in the map.

## Options

- **Filter root state per principal.** The natural AHP shape and what a client handles best, since absence needs no error handling at all. Rejected: `serverSeq` and the replay buffer are per host, so a filtered client would be corrected by the next broadcast.
- **Filter only the `terminals` key in the snapshot, since it is optional and carries titles.** Rejected for the same reason one step later: `root/terminalsChanged` is dispatched from five call sites and would deliver the full list to a connection that was not given one.
- **Check permissions inside each handler.** What `needsWrite` did. Rejected: a new handler is then unprotected until somebody remembers it, which is the failure mode a single boundary removes.
