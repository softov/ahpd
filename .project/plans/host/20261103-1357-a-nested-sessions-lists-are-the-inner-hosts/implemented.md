---
title: A nested session's lists are the inner host's - implemented
date: 2026-11-03
refs:
  - git://f81d5cc2 - the change
  - git://6e2b200f - task 02's change
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
  - "[code://packages/sdk/src/host/changesets.ts](../../../../packages/sdk/src/host/changesets.ts)"
---

The proxy relays the inner host's changeset and canvas lists and its lead chat's row, under the names it serves them by out here.
Each inner changeset and canvas is served out here, a subscribe answered from the host inside and its actions relayed.
A review and an operation are carried in.
The outer host lays none of its own lists on a nested session, and refuses a plugin's canvas on its chat.
A client's read and archive of the lead chat go to the host inside, whose bits are the chat's, as *Task 02* says.

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

## Task 02

A client's read and archive of a nested session's lead chat go to the host inside through `Session.flag`, and that host answers the client.
The bits it says on the chat are kept here as said, and the session's read bit follows a read as it follows any chat's.
The outer host moves none of the lead chat's bits at a turn's start or end.

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `Session.flag`.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - `flag`, carried inside with the client's answer.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a read or an archive handed to a backend that takes `flag`.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - such a backend's bits kept as said, and none of this host's own on its chat.
- [`code://packages/sdk/test/nested-proxy.test.ts`](../../../../packages/sdk/test/nested-proxy.test.ts) - a read and an archive of the lead chat through a host.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the rows of the two actions.

Verified:

- On `fa9afa9a`'s sources the new case fails: a client hears the turn's unread twice, once from the host inside and once from this host.
- With the change it passes, and the nested proxy test file passes alone at one worker.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- The session's own read and archived bits stay this host's: a client's read or archive of the session moves them here, as for any session.
