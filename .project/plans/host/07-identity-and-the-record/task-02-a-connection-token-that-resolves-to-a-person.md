---
title: A connection token that resolves to a person
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/listen.ts#L73-L86](../../../../packages/sdk/src/listen.ts#L73-L86) - `allowed`, the synchronous root-token check that gains a second question"
  - "[code://packages/sdk/src/listen.ts#L100-L135](../../../../packages/sdk/src/listen.ts#L100-L135) - the Bun path, which resolves nothing today and refuses before the socket"
  - "[code://packages/sdk/src/listen.ts#L137-L182](../../../../packages/sdk/src/listen.ts#L137-L182) - the Deno path, where the resolved answer can be closed over"
  - "[code://packages/sdk/src/listen.ts#L203-L222](../../../../packages/sdk/src/listen.ts#L203-L222) - the Node `verifyClient` and `connection` pair, where the answer has to travel between them"
  - "[code://packages/sdk/src/types/listen.ts#L6-L14](../../../../packages/sdk/src/types/listen.ts#L6-L14) - `OnConnect`, which gains the person"
  - "[code://packages/sdk/src/types/listen.ts#L38-L63](../../../../packages/sdk/src/types/listen.ts#L38-L63) - `ListenOptions.token`, beside which the directory question goes"
  - "[code://packages/sdk/src/types/host.ts#L545-L560](../../../../packages/sdk/src/types/host.ts#L545-L560) - `Host.accept`, which gains the person"
  - "[code://packages/sdk/src/host.ts#L4474-L4478](../../../../packages/sdk/src/host.ts#L4474-L4478) - the `Connection` literal a principal has to be written into"
  - "[code://packages/sdk/src/types/users.ts#L64-L84](../../../../packages/sdk/src/types/users.ts#L64-L84) - `Principal`, the shape the listener carries without knowing where it came from"
---

## Objective

A token presented on the WebSocket that is not the deployment's own is asked of the directory, and a match admits the socket with that person's principal already on the connection, so the first command they send is served as them without an `authenticate`.

## Files

- `UPDATE: packages/sdk/src/types/listen.ts:38-63` - `ListenOptions.identify`, a question `listen` asks about a token that is not the root's, answered with a `Principal` or nothing.
- `UPDATE: packages/sdk/src/types/listen.ts:6-14` - `OnConnect` takes the person, so the host is told at the moment the connection is built.
- `UPDATE: packages/sdk/src/listen.ts:73-86` - `allowed` becomes `identityOf`, returning the principal the socket carries: nothing for the root token, the directory's answer otherwise, and a refusal when neither.
- `UPDATE: packages/sdk/src/listen.ts:100-182` - the Bun and Deno upgrade paths resolve once and hand the answer to `onConnect`.
- `UPDATE: packages/sdk/src/listen.ts:203-222` - the Node path resolves in `verifyClient` and carries the answer to the `connection` event.
- `UPDATE: packages/sdk/src/types/host.ts` and `packages/sdk/src/host.ts:4474-4478` - `accept(peer, principal?)` writes it onto the `Connection`.
- `CREATE: test/listen-identity.test.ts` - the door matrix.
- `UPDATE: test/users-gate.test.ts` - the same secret is a door and a protocol credential, and both arrive at the same principal.

## Steps

1. Add `identify?: (token: string) => Promise<Principal | undefined> | Principal | undefined` to `ListenOptions`, with a comment saying it is asked only when the token is not the deployment's, so a host with no directory behaves identically.
2. Replace `allowed` with a resolver that first compares the root token with `same`, then asks `identify`, and returns either a principal, the marker for "admitted with nobody", or a refusal.
3. Change `OnConnect` and `Host.accept` to carry the principal, type-only from `types/users.ts`, so `packages/sdk` keeps importing no runtime value from the directory.
4. Thread the resolved answer through all three runtimes: Bun stores it where `websocket.open` can read it, Deno closes over it, and Node carries it from `verifyClient` to `connection`.
5. Make `accept` write it into the `Connection` literal beside `tokens`, before any handler can run.
6. Write `test/listen-identity.test.ts`: a guarded host with a root token admits it and the connection has no principal; the same host admits a person's token and their first gated command is served; a token that is nobody's is refused with 401 and no socket; an unguarded host admits a connection with no token and still attaches the principal when one is presented; a removed person's token is refused on the next connection.

## Validation

- `test/listen-identity.test.ts` - the five cases in step 6.
- `test/users-gate.test.ts` - a connection that arrived with a personal token and a connection that pushed the same secret through `authenticate` end at the same principal and the same decisions.
- `test/host.test.ts` and `test/listen.test.ts` unchanged and green, which is the proof that a host with no directory did not move.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
`ListenOptions.identify` is the question a token that is not the deployment's is put to; `OnConnect` and `Host.accept` carry a `Principal`; and all three runtimes resolve before the socket.
Bun carries the answer on `ws.data` through `upgrade(req, { data })`, Deno closes over it, and Node carries it from `verifyClient` to `connection` in a `WeakMap` keyed by the request.
`test/listen-identity.test.ts` holds the matrix, including the bearer header and a token that stops being somebody's, and `test/users-gate.test.ts` proves the gate serves such a connection with no `authenticate`.
The unguarded case is deliberate and tested: a token nobody recognises is a socket that is nobody rather than a refusal, because `--without-connection-token` means nothing is required at the door.

