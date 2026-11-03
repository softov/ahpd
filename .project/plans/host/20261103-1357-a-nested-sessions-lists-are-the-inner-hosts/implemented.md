---
title: A nested session's lists are the inner host's - implemented
date: 2026-11-03
refs:
  - git://f81d5cc2 - the change
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
  - "[code://packages/sdk/src/host/changesets.ts](../../../../packages/sdk/src/host/changesets.ts)"
---

The proxy relays the inner host's changeset and canvas lists and its lead chat's row, under the names it serves them by out here.
Each inner changeset and canvas is served out here, a subscribe answered from the host inside and its actions relayed.
A review and an operation are carried in.
The outer host lays none of its own lists on a nested session, and refuses a plugin's canvas on its chat.
The read and archived bits of the lead chat's row stay the outer host's, laid on the status the host inside says.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `SessionChannel`, and `Session.channel`.
- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `Start.emitOn`, and the channel `Start.handed` takes.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - the lists relayed, the outer names, the relays and the lists said again at a start.
- [`code://packages/sdk/src/host/changesets.ts`](../../../../packages/sdk/src/host/changesets.ts) - `relayedChannel` and `relaysChangesets`; the folder's changesets held back.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `emitOn`, and this host's bits laid on a backend's chat row.
- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts), [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/sdk/src/host/facts.ts`](../../../../packages/sdk/src/host/facts.ts) - the subscribe routed, and this host's lists and row fields held back.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/resourcemethods.ts`](../../../../packages/sdk/src/host/resourcemethods.ts) - a review and an operation carried to the backend.
- [`code://packages/sdk/src/host/canvases.ts`](../../../../packages/sdk/src/host/canvases.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a canvas on a nested chat refused, and a relayed channel let go.
- [`code://packages/sdk/test/nested-proxy.test.ts`](../../../../packages/sdk/test/nested-proxy.test.ts) - the relay case, and the changeset and canvas cases through a host.

## Verified

- On `c97d8459`'s sources the three new cases fail, and they pass with the change.
- On those sources the lists and the row are dropped, and the outer folder's changesets are listed on the nested session.
- The nested proxy, process, start, background and secrets test files pass, one file at a time.
- So do the sdk's files for canvases, changes, operations, the catalogue, chats, names, snapshots and tools.
- So do the files for wire, conformance, the computer refusals and the server's config layers.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

None.
