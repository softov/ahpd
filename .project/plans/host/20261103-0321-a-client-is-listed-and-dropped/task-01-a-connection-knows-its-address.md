---
title: A connection knows its address
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/listen.ts#L38-L56](../../../../packages/sdk/src/types/listen.ts#L38-L56) - `Opened` gains the socket number, the address and `forwardedFor`"
  - "[code://packages/sdk/src/listen.ts#L54-L57](../../../../packages/sdk/src/listen.ts#L54-L57) - `openedOf`, which each runtime calls"
  - "[code://packages/sdk/src/host.ts#L1999-L2043](../../../../packages/sdk/src/host.ts#L1999-L2043) - `accept`, which copies `Opened` to `Connection`"
  - "[code://packages/server/src/commands/run.ts#L1903-L1918](../../../../packages/server/src/commands/run.ts#L1903-L1918) - the two calls to `host.accept`, which drop `opened` today"
---

## Objective

Each accepted socket arrives at the host with its number, its remote address and the `X-Forwarded-For` text.
`Connection` keeps them with the moment it opened.

## Files

- `UPDATE: packages/sdk/src/types/listen.ts:38-56` - add `socket`, `address` and `forwardedFor` to `Opened`, each with a comment.
- `UPDATE: packages/sdk/src/listen.ts` - fill the three fields in `openedOf` for Node, Bun, Deno and stdio.
- `UPDATE: packages/sdk/src/types/host.ts:1300-1413` - add `socket`, `address`, `forwardedFor` and `connectedAt` to `Connection`, and `opened` to `Host.accept`.
- `UPDATE: packages/sdk/src/host.ts:1999-2043` - take `opened` in `accept` and set the four fields on the connection.
- `UPDATE: packages/server/src/commands/run.ts:1903-1918` - pass `opened` to `host.accept` on the WebSocket and the stdio paths.
- `UPDATE: packages/sdk/test/listen-identity.test.ts` - cases for the address and `forwardedFor` on Node.
- `UPDATE: packages/sdk/test/host-handshake.test.ts` - a case for the fields on `Connection`.

## Steps

1. Add `socket?: number` to `Opened`, documented as the number `tapping` gives the same socket.
2. Add `address?: string` to `Opened`, documented as the remote address the runtime reports.
3. Add `forwardedFor?: string` to `Opened`, documented as the client's claim, kept as sent and never trusted.
4. Change `openedOf` to take an object with `url`, `node`, `socket`, `address` and `forwardedFor`, and to omit each absent field.
5. On Node, read `request.socket.remoteAddress` and the `x-forwarded-for` header in the `connection` handler.
6. On Bun, read `server_.requestIP(request)?.address` and the header in `fetch`, and carry both on the socket's `data`.
7. On Deno, take the handler's second argument, and read `info.remoteAddr.hostname` when `transport` is `tcp`.
8. On Deno, read the header from the request.
9. On each runtime, pass the number from `++accepted` as `socket`, the number `tapping` already takes.
10. In `overStdio`, pass `openedOf({ socket: 1 })`, and no address.
11. Add `opened?: Opened` as the fourth parameter of `Host.accept` and of `accept` in `host.ts`.
12. In `accept`, set `socket`, `address` and `forwardedFor` from `opened`, and set `connectedAt` to `Date.now()`.
13. In `run.ts`, pass `opened` to `host.accept` in `acceptConnection` and in the `overStdio` callback.
14. Add the Node cases and the handshake case named in *Files*.

## Validation

- `packages/sdk/test/listen-identity.test.ts`: a Node socket gives a loopback `address`, and a header `X-Forwarded-For: 203.0.113.9` gives that text in `forwardedFor`.
- `packages/sdk/test/listen-identity.test.ts`: a socket without the header has no `forwardedFor`.
- `packages/sdk/test/host-handshake.test.ts`: a connection accepted with `opened` holds the three fields and a `connectedAt`.
- Run `pnpm typecheck`. Expect no errors.
- Run `pnpm --filter @ahpd/sdk test`. Expect a pass.
- On a machine with Bun or Deno, start the daemon on that runtime. Read a row's address by hand, and write the result in *Resume*.

## Resume

Done, with one departure from *Files* recorded below.

`Opened` carries `socket`, `address` and `forwardedFor`, and `openedOf` takes an object and leaves out each field the runtime did not supply. Node reads `request.socket.remoteAddress` and the `x-forwarded-for` header in the `connection` handler. Bun reads `server_.requestIP(request)?.address` and the header in `fetch`, and carries both on the socket's data. Deno takes the handler's second argument, reading `info.remoteAddr.hostname` when the transport is `tcp` and the header from the request. `overStdio` passes `openedOf({ socket: 1 })`. `accept` takes `opened` as its fourth parameter and sets `socket`, `address` and `forwardedFor` on the connection with `connectedAt: Date.now()`. `run.ts` passes `opened` on both the WebSocket and the stdio path.

Validation passed. The two Node cases in `packages/sdk/test/listen-identity.test.ts` show the loopback address, the socket number `1` and the forwarded text `203.0.113.9`. They show no `forwardedFor` when the header is absent. The case in `packages/sdk/test/host-handshake.test.ts` shows the three fields and a numeric `connectedAt` on an accepted connection. `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and `pnpm --filter @ahpd/sdk test` passes 4056 with 2 skipped. The by-hand Bun and Deno check is waiting: neither runtime is installed on this box.

**Departure:** the handshake case cannot read a `Connection`, which has no public reader. This task also adds the read side, so the validation can see a connection. That is `ConnectedClient` and `ClientRegistry.connected()` in `types/host.ts`, the `clientRow` projection in `host.ts`, and `Host.clientRegistry`. `watch`, `drop`, `ClientChange`, the channel, the grants and the docs stay in task 02. Task 02 asks to add `clients` to `Host`, which already exists as `Clients` and cannot be reused, because `Clients.watch(client, uri, options)` would collide with `ClientRegistry.watch(onChange)`. The name used is `clientRegistry`, after its type. That choice is recorded as an open question in the plan's *Resume state*.
