---
title: The host takes a root config port, shown to config:read
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/host.ts#L64-L263](../../../../packages/sdk/src/types/host.ts#L64-L263) - `HostOptions`"
  - "[code://packages/sdk/src/host.ts#L5009-L5044](../../../../packages/sdk/src/host.ts#L5009-L5044) - `rootState`"
  - "[code://packages/sdk/src/host.ts#L1655-L1674](../../../../packages/sdk/src/host.ts#L1655-L1674) - `seenBy`"
  - "[code://packages/sdk/src/host.ts#L8086-L8145](../../../../packages/sdk/src/host.ts#L8086-L8145) - the handler"
---

## Objective

`HostOptions.rootConfig` is a port `{ schema(), values(), write(values) }`; a connection holding `config:read` gets its properties and values beside the host's own, and nobody else does; a `root/configChanged` naming its keys needs `config:write` and goes to `write`, whose answer sets or clears `_meta["ahpd.restartNeeded"]` in root state; a refused write is a `rejectionReason` naming the key.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - the port type, documented.
- `UPDATE: packages/sdk/src/host.ts` - `rootState` per connection, the handler, `seenBy` for the echo.
- `UPDATE:` the host tests for root config.

## Steps

1. Tests first with a fake port: an admin connection sees its keys and a member does not; a member's write is refused; an admin's write reaches `write`, and its echo reaches admins only; an answer of `restartNeeded` puts the `_meta` in root state for everyone.
2. Implement; the three host keys behave as today.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
