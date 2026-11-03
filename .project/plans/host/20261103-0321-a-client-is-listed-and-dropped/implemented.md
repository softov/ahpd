---
title: A client is listed and dropped - implemented
date: 2026-11-03
refs:
  - git://73af0e5d
  - "[code://packages/sdk/src/clients/channel.ts](../../../../packages/sdk/src/clients/channel.ts)"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts)"
---

A daemon now lists every connection it serves on `x-ahpd-clients://`, and an operator can drop one from that list. A row carries the client id, name, protocol version, locale, the person it signed in as, the address its socket reported and the connect time. It also carries the `X-Forwarded-For` text the request sent, kept as a claim, and the frames and bytes each direction has carried. Reading the list needs `client:read`, dropping needs `client:drop`, and a drop answers the row before the socket closes. A dropped client may connect again at once, as a new row.

## What was built

- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `ConnectedClient`, `ClientChange` and `ClientRegistry`, and `Host.clientRegistry` answering `connected()`, `watch()` and `drop()`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the registry over the host's connections, in arrival order, and a departure said once as a connection leaves.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - an arrival said once a connection has given its client id, through `clientsChanged` on the host context.
- [`code://packages/sdk/src/clients/channel.ts`](../../../../packages/sdk/src/clients/channel.ts) - `clientsChannel`: the records source over the registry, the `drop` operation, and the counters on a row. It holds the 5-second timer that runs only while the list has a subscriber.
- [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts) and [`code://packages/sdk/src/types/kinds.ts`](../../../../packages/sdk/src/types/kinds.ts) - the `client` operation scope, and a target for every scope but `list`.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the channel served beside the tunnels one, and the traffic counted in the tap and dropped with its socket. The timer is stopped on the way down.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the `x-ahpd-clients` section, with the row fields, the two grants, the counters and their cadence.

## Verified

- `packages/sdk/test/listen-identity.test.ts` - a Node socket keeps its number, its address and its forwarded claim.
- `packages/sdk/test/clients-channel.test.ts` - the rows, the two grants, the drop and its answer before the close, and a reconnect as a new row. It also covers the counters on a row, the 5-second tick, and the timer that runs only with a subscriber.
- `packages/sdk/test/kinds-operations.test.ts` - a `client` operation takes `target.id`, and its refusal names the scope.
- `pnpm --filter @ahpd/sdk test` passes 4069 with 2 skipped.
- `pnpm --filter @ahpd/server test` passes 1756 with 2 skipped. The first run timed out on `plugin-load.test.ts`'s bot row at 5 seconds under load; the whole suite passed on the re-run.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.

Waiting, because this box has neither runtime and no daemon was started:

- A Bun connection's `address` and `forwardedFor`, read from `server.requestIP`.
- A Deno connection's `address` and `forwardedFor`, read from `info.remoteAddr`.
- A client connected over WebSocket on Node is a row on `x-ahpd-clients://` with its address, version and connect time.
- A reader without `client:read` is refused, `drop` without `client:drop` is refused, and a drop's answer arrives before the socket closes.
- Frames and bytes grow in each direction and reach a reader within 5 seconds, on a running daemon.

## Departures from the plan

- The registry is `Host.clientRegistry`, not `Host.clients` - `clients` is the resource-provider view, and its `watch(client, uri, options)` clashes with `ClientRegistry.watch(onChange)`. It is named for its type, as `HostOptions.nodes` is.
- An arrival is said from `host/handshake.ts`, through `clientsChanged` added to `HostContext`. `host.ts` cannot see the handshake, and would list a row before it has a client id.
- The read side of task 01 - `ConnectedClient`, `ClientRegistry.connected()`, `clientRow` and the host property - was built in task 01, because `Connection` had no public reader.
- The counter timer starts in the channel's `snapshot`, because the host records a subscription after the snapshot returns; the first tick reads the subscriber list.
- `ClientCounts` is declared in `clients/channel.ts` and exported from the package for the daemon's map.

## Left for later

- The by-hand Bun, Deno and running-daemon checks above are waiting.
- Tasks 02 and 03 are in the worktree and not committed. `git add` is refused for the two new files. Committing the tracked changes alone would leave a commit that imports a module it does not hold.
