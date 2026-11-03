---
title: A client is listed and dropped
created: 2026-11-02
refs:
  - git://a8eff676d9e7f0c482f036d381c3e1687d07dd5a - the commit of this repository the facts were checked at
  - "[code://packages/sdk/src/types/host.ts#L1300-L1413](../../packages/sdk/src/types/host.ts#L1300-L1413) - the `Connection` record, which holds no address and no connect time"
  - "[code://packages/sdk/src/types/host.ts#L1430-L1463](../../packages/sdk/src/types/host.ts#L1430-L1463) - `Clients`, the only enumeration of connected clients today"
  - "[code://packages/sdk/src/host/context.ts#L68](../../packages/sdk/src/host/context.ts#L68) - the live set of connections"
  - "[code://packages/sdk/src/host/handshake.ts#L311-L371](../../packages/sdk/src/host/handshake.ts#L311-L371) - where a connection is named, versioned and announced to the log"
  - "[code://packages/sdk/src/types/listen.ts#L38-L56](../../packages/sdk/src/types/listen.ts#L38-L56) - `Opened` and `OnConnect`, the seam an address arrives on"
  - "[code://packages/sdk/src/types/listen.ts#L67](../../packages/sdk/src/types/listen.ts#L67) - `Tap`, which already sees every frame of every connection"
  - "[code://packages/sdk/src/listen.ts#L242](../../packages/sdk/src/listen.ts#L242) - Bun's `fetch`, where the request and the server are in hand before the upgrade"
  - "[code://packages/sdk/src/listen.ts#L301](../../packages/sdk/src/listen.ts#L301) - Deno's handler, which takes only the request today"
  - "[code://packages/sdk/src/listen.ts#L404](../../packages/sdk/src/listen.ts#L404) - Node's `connection` event, which hands the request"
  - https://bun.sh/docs/api/http#server-requestip-request - `server.requestIP(request)`, which answers `{ address, port }` or null
  - https://docs.deno.com/api/deno/~/Deno.ServeHandlerInfo - `remoteAddr`, on the second argument of a `Deno.serve` handler
  - "[code://packages/sdk/src/types/host.ts#L81-L119](../../packages/sdk/src/types/host.ts#L81-L119) - `JoinedNode` and `NodeRegistry`, the live registry this one would copy"
  - "[code://packages/sdk/src/nodes.ts#L563](../../packages/sdk/src/nodes.ts#L563) - how a node registry drops one and tells its watchers"
  - "[code://packages/sdk/src/connectors/channel.ts#L1-L77](../../packages/sdk/src/connectors/channel.ts#L1-L77) - the channel and command pattern to follow"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L1-L32](../../packages/sdk/src/resources/recordschannel.ts#L1-L32) - the records channel helper, written for a store"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/protocolServerHandler.ts#L457-L475 - the reference host's connected client record, read at 171e90619c7 (2026-10-27)
---

# A client is listed and dropped

An operator must see which clients a daemon is serving, and must be able to disconnect one.
Today a connection is announced once, in a log line at its handshake, and nothing else reports it.
The list holds each client's id, its address, the protocol version it agreed on, and the moment it connected.
It holds counters later, such as the packets, sessions, messages and events of that connection.
A command on the same channel drops a client.
The channel and its commands are declared as the plugin and connector channels are.

## What others do

VS Code is the reference host, and it keeps more for each connection than ahpd keeps.
Its `IConnectedClient` holds the client id, the client's own name, the agreed protocol version, a telemetry context, the transport, the channels subscribed, and a `connectionStopWatch`.
That stopwatch is the connect time this change needs.
The reference publishes none of it: no method under `src/vs/platform/agentHost` lists clients.
So the reference does not answer this question, and ahpd adds the channel as its own.

## What ahpd has today

`Connection` already holds most of what the list needs.
It has the client id, the agreed protocol version, the locale, the person signed in, and the channels it watches.
It also says whether the socket came in on the deployment's own token.
The name a client gave is in `clientNames`, and `Peer.buffered()` reports how far behind a client is.
Three things are missing from it: the remote address, the moment the connection opened, and every counter.

Nothing in the daemon records a remote address.
The seam for one is `Opened`, which carries the URL and the node today, and `OnConnect`, which hands it to the host.
Each runtime gives the address where the listener already holds the request:

| Runtime | Call | Where in the listener |
| --- | --- | --- |
| Node | `request.socket.remoteAddress` | the `connection` event, which hands the request |
| Bun | `server.requestIP(request)`, which answers null for a Unix socket | `fetch`, before the upgrade, so the address rides on the socket's data |
| Deno | `info.remoteAddr`, from the handler's second argument | the `Deno.serve` handler, which takes only the request today |
Counters have a natural source in `Tap`, which is called with every frame in both directions and numbers each connection.

The host enumerates its clients in one place only.
`Clients` answers the connected ids so that a `<scheme>://<clientId>/…` URI reaches the client that publishes it, and the live set behind it is `connections`.
Neither is reachable from the wire.

The channel pattern is settled, and every `x-ahpd` record channel uses it, such as `x-ahpd-connectors`, `x-ahpd-tunnels` and `x-ahpd-users`.
A subscribe answers a snapshot, and `added`, `changed` and `removed` follow it.
A command is named `x-ahpd/<channel>/<verb>`, takes the row's id, and answers the row, as `x-ahpd/connectors/remove` does.
Two sources can serve such a channel.
The records channel helper reads a store through an asynchronous `ids()` and `find()`.
`NodeRegistry` instead answers what is connected now.
It calls a watcher on each arrival and each departure, which is what a set of live sockets needs.

## Who writes

The fork branches that changed the handshake and `Connection` on 2026-11-02 are merged, and so is plan `20261102-1122-the-host-keeps-the-tunnels`.
These unmerged branches still change the files of this change:

| Branch | Files |
| --- | --- |
| `maycxc/host/124-an-agents-shell-is-a-terminal-the-person-sees` | `types/host.ts`, `host/context.ts` |
| `maycxc/host/20261101-0329-the-hosts-state-is-the-reducers-output` | `types/host.ts`, `host/context.ts` |
| `maycxc/host/20261101-0331-a-chats-read-state-is-its-own` | `types/host.ts`, `host/context.ts` |
| `maycxc/union-2026-11-01-fc4fe451` | `types/host.ts`, `host/handshake.ts`, `host/context.ts` |
| Nine other `maycxc/host/` and `maycxc/union-` branches | `host/context.ts` only |

Take the fork's branches before this is planned, so the new field lands on the handshake the fork leaves behind.
No branch touches `packages/sdk/src/types/listen.ts` or `packages/sdk/src/listen.ts`.

## Answers

| What | Source |
| --- | --- |
| `client:read` reads the channel and `client:drop` drops a client, as `tunnel:read` and `tunnel:delete` do | Softov, 2026-11-02, chose "Two grants" |
| Drop is an operation in the state of `x-ahpd-clients://`, run with `x-ahpd/invokeOperation` and `target: { id }`, as a tunnel's operations are | Softov, 2026-11-02, chose "An operation" |
| A row holds the socket address, and holds what `X-Forwarded-For` claims in a field of its own, named as a claim | Softov, 2026-11-02, chose "Both, labelled" |
| A drop closes the socket and nothing more. The client may reconnect at once, and a revoked token keeps it out | Softov, 2026-11-02, chose "Yes, a drop is no ban" |
| A caller that drops its own connection gets the answer, and then the socket closes | Softov, 2026-11-02, chose "Answer, then close" |
| The first counters are frames and bytes in each direction, from `Tap`. Sessions, messages and events come in a later change | Softov, 2026-11-02, chose "Packets and bytes" |
| The rows come from a live client registry, as `NodeRegistry` serves nodes, not from the records channel helper | (defaulted: the helper reads a store, and a socket set changes by the second) |

## The change

- The listener reads the remote address of each accepted socket on Node, Bun and Deno, and puts it on `Opened` with the `X-Forwarded-For` value.
- `OnConnect` carries both to the host, and `Connection` keeps them beside the moment the connection opened.
- A client registry answers the connections held now, and tells a watcher of each arrival and departure.
- A host channel, `x-ahpd-clients`, publishes one row for each connection from that registry. Reading it takes `client:read`.
- A row holds the client id, the client's name, the socket address, the claimed forwarded address and the agreed protocol version.
- A row also holds the locale, the principal, the channels watched, the connect moment, and the frames and bytes in each direction.
- The channel state has a `drop` operation that takes `client:drop`. It answers the row it closed, and then closes that connection.

## Open points

None.
