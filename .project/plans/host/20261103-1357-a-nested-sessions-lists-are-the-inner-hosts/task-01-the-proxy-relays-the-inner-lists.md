---
title: The proxy relays the inner lists
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - `served`, the proxy's state, the relays and `channel`"
  - "[code://packages/sdk/src/host/changesets.ts](../../../../packages/sdk/src/host/changesets.ts) - `relayedChannel` and `relaysChangesets`"
---

## Objective

The proxy relays the inner host's changeset and canvas lists and its lead chat's row, under the outer names.
It serves each inner changeset and canvas out here, and carries a review and an operation in.
The outer host lays none of its own lists on a nested session, and keeps the read and archived bits of the lead chat's row.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `SessionChannel`, and `Session.channel`.
- `UPDATE: packages/sdk/src/types/agent.ts` - `Start.emitOn`, and the channel `Start.handed` takes.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - the lists relayed, the outer names, the relays, and the lists said again at a start.
- `UPDATE: packages/sdk/src/host/spawn.ts` - `emitOn`, the channel `handed` takes, and this host's bits laid on a backend's chat row.
- `UPDATE: packages/sdk/src/host/changesets.ts` - `relayedChannel` and `relaysChangesets`, and the folder's changesets held back.
- `UPDATE: packages/sdk/src/host/snapshots.ts` - a subscribe answered by the backend, and no changesets or canvases of this host laid on.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - the row of a chat whose backend serves it, and `factsMoved`.
- `UPDATE: packages/sdk/src/host/facts.ts` - no folder changesets said on a nested session.
- `UPDATE: packages/sdk/src/host/actions.ts` - a review carried to the backend.
- `UPDATE: packages/sdk/src/host/resourcemethods.ts` - an operation carried to the backend.
- `UPDATE: packages/sdk/src/host/canvases.ts` - a plugin's canvas on a nested chat refused.
- `UPDATE: packages/sdk/src/host.ts` - a relayed channel let go once nobody watches it, and the canvas store told which chats relay.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the relay case, and the changeset and canvas cases through a host.

## Steps

1. Remove `OUTER_OWN` and the lead chat's drop from `served`.
2. Keep the inner lists in the proxy's session and chat state.
3. Name each inner changeset and canvas by its outer name in `outward`.
4. Serve each through `Session.channel`, mirrored with the protocol's reducer.
5. Route a subscribe, a review and an operation on such a channel to the backend.
6. Hold back the outer host's changesets, canvases and row fields for such a session.
7. Lay the outer host's read and archived bits on a relayed row's status.
8. Say the lists again at a start where the host inside holds others.
9. Add the cases.

## Validation

- The new cases fail on `c97d8459`'s sources and pass after.
- The touched files' test files pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
