---
title: An active client set is taken as sent
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - `session/activeClientSet`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `leaves`"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the oracle's rows 035 and 036"
---

## Objective

A `session/activeClientSet` keeps the `clientId` it names.
The entry leaves with the connection that announced it, under the id the entry carries.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts` - the entry is the client's; a `clientId` or `tools` left out is filled.
- `UPDATE: packages/sdk/src/host.ts` - `leaves` removes the entry under its own `clientId`.
- `UPDATE: packages/sdk/test/presence.test.ts` - an entry naming another client is held as sent and leaves with its connection.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - the rows for 035 and 036 go.

## Steps

1. Keep the action's `clientId`; fill it with the sender's when it is absent.
2. Leave the `tools` fill as it is.
3. Remove the entry under the `clientId` it carries when its connection leaves.

## Validation

- `pnpm exec vitest run packages/sdk/test/presence.test.ts packages/sdk/test/ahp-test-cases.test.ts` - passes; the changed cases fail on c3c8c3e4.
