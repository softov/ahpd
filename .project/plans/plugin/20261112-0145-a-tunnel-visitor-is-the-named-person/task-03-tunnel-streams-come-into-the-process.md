---
title: Tunnel streams come into the daemon's process
status: todo
depends: [task-01-a-plugin-admits-a-person-by-a-key.md, task-02-a-tunnel-record-names-a-person.md]
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L39-L99](../../../../packages/tunnel-devtunnel/src/forward.ts#L39-L99) - the listener and the request rewrite that change here"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L341-L345](../../../../packages/tunnel-devtunnel/src/service.ts#L341-L345) - `relay`, where local forwarding is turned off"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L218-L224](../../../../packages/tunnel-devtunnel/src/kind.ts#L218-L224) - `hopFor`, which starts the listener today"
  - "[code://packages/tunnel-devtunnel/src/discovery.ts](../../../../packages/tunnel-devtunnel/src/discovery.ts) - `deriveConnectionToken`, the token a VS Code client presents"
  - https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/agent_host.rs#L1547-L1553 - VS Code's CLI rewrites each request in its own process
---

## Objective

The relay host hands each tunnel connection to the daemon's process as a stream, and no port listens for the tunnel. A request with the derived token reaches the daemon as the named person.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/service.ts:341-345` - `relay` sets `forwardConnectionsToLocalPorts` to false and passes each `forwardedPortConnecting` stream to a handler.
- `UPDATE: packages/tunnel-devtunnel/src/forward.ts` - the listener goes. The request rewrite takes a stream and dials the daemon on loopback.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:218-224` - `hopFor` becomes the stream handler for the tunnel's ports.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the stream cases.

## Steps

1. Set `forwardConnectionsToLocalPorts` to false on the `TunnelRelayTunnelHost` in `relay`.
2. Pass each `forwardedPortConnecting` stream to a handler that the kind gives the service.
3. For port 31546, read each request on the stream, a WebSocket upgrade among them.
4. If `tkn` equals the derived token and the record names a person, set the person's key.
5. If `tkn` equals the derived token on a host with no users, set the daemon's token.
6. If `tkn` equals the derived token, the host has users and the record names nobody, answer 401.
7. Raise a tunnel alert for that 401.
8. Pass any other `tkn` and any `Authorization` header through unchanged.
9. Dial the daemon's port on loopback for each request, whatever port the daemon is on.
10. For any other port on the tunnel, pipe the stream to that local port unchanged.
11. Remove the TCP listener on 31546, and the `forward` export if nothing else uses it.
12. Rewrite the file comment of `forward.ts` to say what it does now, and cite VS Code's `agent_host.rs#L1547-L1553`.

## Validation

- A test with a stand-in stream: a request with the derived token reaches the daemon with the person's key.
- A test where a request with another token reaches the daemon with that token unchanged.
- A test where a host with users and no person answers 401.
- A test where a host with no users sets the daemon's token.
- Test a WebSocket upgrade with the derived token. Expect the daemon to admit the person.
- By hand: with the system tunnel up and the daemon on another port, `ss -ltnp` shows nothing on 31546.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/tunnel-devtunnel` passes.

## Resume

