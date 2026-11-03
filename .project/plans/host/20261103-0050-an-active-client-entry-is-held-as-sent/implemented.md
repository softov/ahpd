---
title: An active client entry is held as sent - implemented
date: 2026-11-03
refs:
  - git://8582876a - the change
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
---

A `session/activeClientSet` is taken as sent, its entry held under the `clientId` it carries.
A client's leaving takes out the entry under its own id, so an entry naming another client outlives its sender.

## What was built

- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - the refusal goes, and the entry is held under its own `clientId`.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `session/activeClientSet` row.

## Verified

- The changed presence case fails on `f419294d`'s source, the entry refused, and passes with the change.
- The protocol's cases 035 and 036 add and replace another client's entry, and hold as written: their divergence rows go.
- On `f419294d`'s source both fail, refused; with the change the protocol's cases pass, with presence, 668 of 668.
- The presence, snapshot, name gate and nested proxy files pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.
