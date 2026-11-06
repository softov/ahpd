---
title: devtunnel shows its account
status: todo
depends: [task-03-a-data-event-sets-a-value.md]
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/adapter.ts#L373](../../../../packages/tunnel-devtunnel/src/adapter.ts#L373) - the adapter's empty capabilities"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts#L400](../../../../packages/tunnel-devtunnel/src/adapter.ts#L400) - `open`, which holds the token and runs the refresh"
  - git://78d222d9 - #248's `TUNNEL_UI`, which becomes `TUNNEL_VIEW`
---

## Objective

A devtunnel connector shows the account it signed in as, and the time of its last token refresh, on its `main` view.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/adapter.ts:373` - a `view` capability named `main`.
- `UPDATE: packages/tunnel-devtunnel/src/adapter.ts:400` - `open` shows `TUNNEL_VIEW`, and a refresh sets its time.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-adapter.test.ts` - #248's cases, for the view.

## Steps

1. Rename #248's `TUNNEL_UI` to `TUNNEL_VIEW`, a `PluginView` whose texts bind to `/account` and `/refreshed`.
2. Declare `{ type: 'view', name: 'main' }` on the adapter.
3. At `open`, call `showView` with `TUNNEL_VIEW` and the account the record holds.
4. After each refresh that stores a new pair, call `setViewData('/refreshed', <time>)`.
5. Leave `tunnelView`, the plugin's own page, as it is.

## Validation

- `tunnel-devtunnel-adapter.test.ts`: the adapter declares a `view` capability named `main`.
- `tunnel-devtunnel-adapter.test.ts`: `open` shows the account with no call to the service.
- `tunnel-devtunnel-adapter.test.ts`: a refresh sets the new time with `setViewData`.
- `pnpm typecheck` passes.
- `pnpm exec vitest run packages/tunnel-devtunnel/` passes.

## Resume
