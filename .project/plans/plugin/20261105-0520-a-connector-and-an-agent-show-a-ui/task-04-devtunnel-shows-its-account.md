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

Done. `adapter.ts` holds `TUNNEL_UI`: a Column of the account and the time of the last refresh, each a `Text` bound to `account` and `refreshed`. The adapter declares it as its one capability, `{ type: 'ui', name: 'account' }`, and nothing else changed of its registration.

`open` takes the handle beside the connector and keeps it in the open's own closure, where the timer and the running refresh already live. A `show` builds the data from the account the record holds and the last refresh this open stored, and leaves a field out until it has a value: at open that is the account alone, since the record has no time to draw, and a path with no data draws nothing. `show` runs once at open, immediately, and again after each successful refresh, after the pair is written to the vault and held, so the time drawn is of a pair already stored.

`tunnelView` and the plugin's page are unchanged, and the plugin's `plugin.ts` is untouched: the capability travels with the adapter object it builds.

Verified: `pnpm exec tsc -p tsconfig.json --noEmit` printed nothing, `pnpm boundary` reported every package with none undeclared, and `pnpm exec vitest run packages/tunnel-devtunnel/` passed 5 files with 54 tests. The adapter test has three new cases: the capability at registration, the account at open with no call to the service, and the new time after a refresh.

Found: the time of the last refresh is what this open stored, because the record keeps neither the time nor a plain token's age. An open draws no time until its own refresh answers, which happens at once for a record holding a refresh token and never for one holding none.

Left: nothing this task asked for. The by-hand check of a daemon's connector page belongs to task 03's Resume.