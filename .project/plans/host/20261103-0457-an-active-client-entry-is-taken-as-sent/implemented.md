---
title: An active client entry is taken as sent - implemented
date: 2026-11-03
refs:
  - git://ed984929 - the change
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
---

A `session/activeClientSet` is held, echoed and shown as sent, under the `clientId` its entry carries, absent included.
A client's leaving takes out the entry under its own id, so an entry naming no client stays until a set replaces it.
Such an entry provides no tools and no plugins.

## What was built

- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - the entry as sent.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the presence map keyed by the entry's `clientId`, and `leaves` naming its own id.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `session/activeClientSet` row.

## Verified

- On `cde4dd6c`'s source the new presence case fails: the entry is said with the sender's id.
- With the change the presence file passes 23 of 23, and the protocol's cases 647 of 647.
- Client plugins pass 14 of 14, the catalogue 73 of 73, a remote session 14 of 14, and tools 83 of 83.
- The ACP client tool file passes 19 of 19, the ACP turn file 38 of 38, and cofold's client tool file 10 of 10.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- The cases that announced a client's own entry with no `clientId` name the sender now, as a VS Code client does.
