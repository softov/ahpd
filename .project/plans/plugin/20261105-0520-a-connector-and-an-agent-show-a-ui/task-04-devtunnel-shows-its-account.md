---
title: devtunnel shows its account
status: implemented
depends: [task-02-the-rows-carry-a-uis-data.md]
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L178](../../../../packages/tunnel-devtunnel/src/plugin.ts#L178) - where the devtunnel adapter is registered"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts](../../../../packages/tunnel-devtunnel/src/adapter.ts) - the adapter, its `open` and its sign-in"
  - "[code://packages/tunnel-devtunnel/src/view.ts#L39](../../../../packages/tunnel-devtunnel/src/view.ts#L39) - `tunnelView`, the plugin page's literal view, which stays as it is"
---

## Objective

A devtunnel connector shows the account it signed in as and the time of its last token refresh.
The adapter declares the schema and sends the data from what it already holds, with no call to the service.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/adapter.ts` - declare the `ui` capability, keep the handle `open` gives, and send the data.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-adapter.test.ts` - the schema and the data.

## Steps

1. Write the schema: the account, then the time of the last refresh.
2. Declare it as a `ui` capability of the devtunnel adapter.
3. Keep the handle `open` gives for each connector.
4. Send the data at `open`, from the connector's signed-in account.
5. Send the data again after each token refresh.
6. Leave `tunnelView` and the plugin's page as they are.

## Validation

- `tunnel-devtunnel-adapter.test.ts`: the adapter registers with its `ui` capability; `open` sends the account; a refresh sends the new time.
- `pnpm --filter @ahpd/tunnel-devtunnel test` and `pnpm typecheck` pass.

## Resume

Done. `adapter.ts` holds `TUNNEL_UI`: a Column of the account and the time of the last refresh.
Each is a `Text` bound to `account` and `refreshed`.
The adapter declares it as its one capability, `{ type: 'ui', name: 'account' }`, and no other part of its registration changed.

`open` keeps the handle in its own closure, beside the timer and the running refresh.
`show` builds the data from the account that the record holds and the last refresh that this open stored.
A field stays out until it has a value, and a path with no data draws nothing.
At open, the data is the account only, because the record holds no time.
`show` runs once at open, and again after each successful refresh.
It runs after the pair is written to the vault and held, so the time it draws is of a stored pair.

`tunnelView`, the plugin's page and the plugin's `plugin.ts` are unchanged, because the capability travels with the adapter object.

Verified: `pnpm exec tsc -p tsconfig.json --noEmit` printed nothing, and `pnpm boundary` reported no undeclared package.
`pnpm exec vitest run packages/tunnel-devtunnel/` passed 5 files: 54 tests.
The adapter test has three new cases:

- The capability at registration.
- The account at open, with no call to the service.
- The new time after a refresh.

Found: the time of the last refresh is the one that this open stored.
The record keeps no time and no age of a plain token.
An open draws no time until its own refresh answers.
A record with a refresh token refreshes at once, and a record with none never refreshes.
