---
title: devtunnel shows its account
status: dropped
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

