---
title: Tunnel streams come into the daemon's process
status: implemented
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

Implemented 2026-11-11, uncommitted in the worktree.

- `service.ts`: `relay` sets `forwardConnectionsToLocalPorts = false` and subscribes to `forwardedPortConnecting`, so no local listener is made. Each stream for a port the kind registered goes to its `Carried` handler; any other port is piped to the same number on loopback. `Service` gains `carry(connector, port, handler | undefined)`, and `ServiceOptions` gains `log`, which `plugin.ts` fills from the plugin's own log.
- `forward.ts`: the listener and the `Forward` type go. `carry(stream, to, admit, log)` reads the stream's first request head, asks `admit` about its `tkn`, answers 401 on a refusal without dialing the daemon, rewrites the request target only when told a token to set, and dials `127.0.0.1:to` - the daemon's port, whatever it is. A failed dial is answered 503, which is where the old forwarder answered its 503. `pipeTo(stream, to, log)` is the plain copy for every other port. The file comment is rewritten and cites `agent_host.rs#L1547-L1553`.
- `kind.ts`: `hopFor` registers a `Carried` handler for port 31546 on the tunnel's connector, whatever port the daemon is on, and reads the record's person to mint that person's key (`plugin.personKey`). It keeps a `Hop` (`derived`, `person`, `key`, `close`) in the running entry. The admission answer, in order: no token or not the derived one is `keep`; the derived one on a host with users is the person's key, or `refuse` with the alert when the key cannot be minted; on a host with no users it is the daemon's token, or `keep` when the daemon requires none.
- `kind.ts`: `start` mints the key and registers the handler before `service.add`, fills in the derived token after the add, and keeps the derived token in the running entry even when no hop exists, so a later port move onto 31546 reuses it. `update` registers the new hop before `replace` and closes it when the replace fails; a change of person alone mints the new key, applies it to the live hop, and fails closed (no key, so the derived token is refused) when the person cannot be minted.
- The line saying the tunnel token now depends on `guarded() && connectionToken() === undefined`, not on the hop being absent: with a guarded daemon and a hop, the client still presents the derived token.
- `index.ts` exports `carry` and `pipeTo` with `Admission`, `Admit` and `Log`, and no longer exports `Forward`.
- `test/tunnel-devtunnel.test.ts`: the two hop tests are replaced by six stream tests over a stand-in `Duplex`: the derived token carried as the person's key; a visitor's own `tkn` and `Authorization: Bearer` unchanged; a host with users and no person answered 401 with the alert and the daemon not reached; a host with no users given the daemon's token; a WebSocket upgrade's 101; a port other than 31546 not carried and unregistered on stop; and, added 2026-11-12, a person whose record requires the issuer not started, with the error and the alert naming the issuer, no handler registered and the daemon not reached. The fake services in that file and in the view and kind tests gain `carry`.
- `pnpm exec tsc -p tsconfig.json --noEmit` passes. The tunnel and server suites were run after the review fixes, and `implemented.md` has the counts.

Departures and gaps:

- The plan's step 9 and the old skip of `daemon === TUNNEL_PORT` do not both hold, so the skip goes: a daemon on 31546 still has the handler, and a derived token is still mapped to a person rather than passed through.
- A person edit on a running tunnel is applied live, which the plan did not specify. It is fail-closed: a key that cannot be minted leaves the derived token refused until a record that does mint one saves again.
- Only a stream's first request is decided. A second request on the same keep-alive stream is carried as it came and the daemon decides its token. The clients that present the derived token are WebSocket upgrades, one request per stream.
- `update` reads `tunnel.settings['person']`, since the saved settings are the new ones.
- `packages/tunnel-devtunnel/README.md` still has a "The connection token" text describing the old hop; task-04 covers `docs/`, and the README needs the same correction.
- By hand `ss -ltnp` on a running tunnel was not checked: no daemon was started or restarted here.
