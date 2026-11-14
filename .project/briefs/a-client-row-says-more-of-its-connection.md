---
title: A client row says more of its connection
created: 2026-11-14
refs:
  - git://dd80ad12ff2be21d469a3393304ff0d5acdbec4b - the commit of this repository the facts were checked at
  - "[code://packages/sdk/src/clients/channel.ts#L91-L101](../../packages/sdk/src/clients/channel.ts#L91-L101) - `rowOf`, which spreads a `ConnectedClient` and adds the id, the person's id and the counters"
  - "[code://packages/sdk/src/types/host.ts#L179-L200](../../packages/sdk/src/types/host.ts#L179-L200) - `ConnectedClient`, the fields a row can carry today"
  - "[code://packages/sdk/src/types/host.ts#L2015-L2117](../../packages/sdk/src/types/host.ts#L2015-L2117) - `Connection`, which holds `root`, `principalUntil` and `tokens` that no row carries"
  - "[code://packages/sdk/src/host.ts#L1973-L1984](../../packages/sdk/src/host.ts#L1973-L1984) - `clientRow`, the one place a connection becomes a `ConnectedClient`"
  - "[code://packages/sdk/src/host.ts#L2235-L2258](../../packages/sdk/src/host.ts#L2235-L2258) - `accept`, which keeps `socket`, `address` and `forwardedFor` from `Opened` and drops `url` and `node`"
  - "[code://packages/sdk/src/host.ts#L2268-L2271](../../packages/sdk/src/host.ts#L2268-L2271) - the send queue limit, `clientQueueBytes`, bound to each peer"
  - "[code://packages/sdk/src/host.ts#L461-L464](../../packages/sdk/src/host.ts#L461-L464) - `clientNames` and `clientVersions`, kept by client id"
  - "[code://packages/sdk/src/host.ts#L1400](../../packages/sdk/src/host.ts#L1400) - `activeClientsOf`, the clients present in one session"
  - "[code://packages/sdk/src/host/handshake.ts#L121-L134](../../packages/sdk/src/host/handshake.ts#L121-L134) - `attached`, which forgets the names, versions and locales of clients gone past the retention"
  - "[code://packages/sdk/src/host/handshake.ts#L344-L348](../../packages/sdk/src/host/handshake.ts#L344-L348) - `initialize` keeps `clientInfo.name` and nothing else of `clientInfo`"
  - "[code://packages/sdk/src/host/handshake.ts#L560](../../packages/sdk/src/host/handshake.ts#L560) - `ping` answers `null` and records nothing"
  - "[code://packages/sdk/src/host/handshake.ts#L574-L637](../../packages/sdk/src/host/handshake.ts#L574-L637) - `reconnect`, the second way in, which says the arrival with no mark of how it came"
  - "[code://packages/sdk/src/types/listen.ts#L40-L56](../../packages/sdk/src/types/listen.ts#L40-L56) - `Opened`, what a listener tells the host of a new socket"
  - "[code://packages/sdk/src/listen.ts#L53-L66](../../packages/sdk/src/listen.ts#L53-L66) - `openedOf`, shared by the three runtimes"
  - "[code://packages/sdk/src/listen.ts#L75-L83](../../packages/sdk/src/listen.ts#L75-L83) - `presented`, which reads the token from `?tkn=` in the URL"
  - "[code://packages/sdk/src/listen.ts#L129-L133](../../packages/sdk/src/listen.ts#L129-L133) - `pathOf`, the URL without its query"
  - "[code://packages/sdk/src/listen.ts#L283-L289](../../packages/sdk/src/listen.ts#L283-L289) - Bun reads the address and `X-Forwarded-For` at the upgrade"
  - "[code://packages/sdk/src/listen.ts#L371-L393](../../packages/sdk/src/listen.ts#L371-L393) - Deno reads the same at the upgrade"
  - "[code://packages/sdk/src/listen.ts#L480-L496](../../packages/sdk/src/listen.ts#L480-L496) - Node reads the same on `connection`"
  - "[code://packages/sdk/src/listen.ts#L761-L766](../../packages/sdk/src/listen.ts#L761-L766) - `NodeRequest`, typed with two headers only"
  - "[code://packages/server/src/commands/run.ts#L846-L860](../../packages/server/src/commands/run.ts#L846-L860) - the tap that counts frames and bytes per socket"
  - "[code://packages/server/src/commands/run.ts#L1084](../../packages/server/src/commands/run.ts#L1084) - `counters`, how the channel reads the tap's counts"
  - "[code://packages/sdk/src/types/users.ts#L42-L62](../../packages/sdk/src/types/users.ts#L42-L62) - `Principal`, with `roles` and `team` beside the id"
  - "[code://docs/plugins/PLUGINS.md#L1874-L1890](../../docs/plugins/PLUGINS.md#L1874-L1890) - the `x-ahpd-clients` section, which names the row fields"
  - https://github.com/softov/agent-host-protocol/blob/2c37a04fc5d220d3d4d4c9155ac1fb3e1b0a1dae/types/common/commands.ts#L124-L232 - `Implementation` and `ClientCapabilities`, checked at 2c37a04f
  - https://github.com/ahpio/ahpc/blob/f20c94843698456bf26654eca82ea38f4dac163e/src/ahp/live.ts#L1685-L1690 - ahpc sends `clientInfo: { name: 'ahpc' }` with no version, checked at f20c948
  - https://redis.io/docs/latest/commands/client-list/ - Redis `CLIENT LIST`, read on 2026-11-14
  - https://github.com/nats-io/nats-server/blob/main/server/monitor.go - NATS `ConnInfo`, the `/connz` row, read on 2026-11-14
  - https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW - PostgreSQL `pg_stat_activity`
---

# A client row says more of its connection

Softov wants the client page in ahpw to say more about a connection than its id, address, protocol, connect time and counters.
This brief covers the ahpd half: what the host collects about each connection, and what `x-ahpd-clients://` sends in each row.
The ahpw brief `a-client-page-shows-its-connection`, in ahpw, follows this one and draws the new fields.

## What others do

Three servers list their connections for an operator, and they agree on most fields.

| Field | Redis `CLIENT LIST` | NATS `ConnInfo` | PostgreSQL `pg_stat_activity` |
|---|---|---|---|
| Client software and its version | `lib-name`, `lib-ver` | `name`, `lang`, `version` | `application_name` |
| Time since the last activity | `idle` | `last_activity`, `idle` | `state_change` |
| Round trip | no | `rtt` | no |
| Bytes queued to send | `obl`, `oll`, `omem` | `pending_bytes` | no |
| Last command | `cmd` | no | `query` |
| Who signed in | `user` | `authorized_user` | `usename` |
| TLS | no | `tls_version`, `tls_cipher_suite` | `pg_stat_ssl` |
| Subscription count | `sub`, `psub` | `subscriptions` | no |

The protocol names one use of `clientInfo` outright: `Implementation` is informational, "for logging, telemetry, an about/status affordance". So a row that shows the client's version is the use the protocol intends.

## What ahpd has today

### A row carries

`clientRow` builds the row from the connection ([`code://packages/sdk/src/host.ts#L1973-L1984`](../../packages/sdk/src/host.ts#L1973-L1984)).
The channel spreads it and adds `id`, the person's id and the four counters ([`code://packages/sdk/src/clients/channel.ts#L91-L101`](../../packages/sdk/src/clients/channel.ts#L91-L101)).

- `socket`, `clientId`, `name`, `address`, `forwardedFor`, `protocolVersion`, `locale`, `principal`, `subscriptions`, `connectedAt`.
- `framesIn`, `framesOut`, `bytesIn`, `bytesOut`, sent at most once each 5 seconds while the list has a reader.
- `operations: ['drop']`.

### Held, but sent in no row

| What | Where it is held | Why it is lost |
|---|---|---|
| The socket came in on the deployment token | `Connection.root` ([`code://packages/sdk/src/types/host.ts#L2083`](../../packages/sdk/src/types/host.ts#L2083)) | `clientRow` does not copy it. A root row and an anonymous row look the same: no `principal` on either. |
| When the sign-in runs out | `Connection.principalUntil` ([`code://packages/sdk/src/types/host.ts#L2090`](../../packages/sdk/src/types/host.ts#L2090)) | `clientRow` does not copy it. |
| The person's roles and team | `Principal.roles`, `Principal.team` ([`code://packages/sdk/src/types/users.ts#L42-L62`](../../packages/sdk/src/types/users.ts#L42-L62)) | `rowOf` keeps `principal.id` only. |
| The tokens the client pushed | `Connection.tokens`, keyed by resource ([`code://packages/sdk/src/types/host.ts#L2108`](../../packages/sdk/src/types/host.ts#L2108)) | Not read for the row. |
| The client's version and title | `clientInfo.version`, `clientInfo.title` at `initialize` | `initialize` keeps the name only ([`code://packages/sdk/src/host/handshake.ts#L344-L348`](../../packages/sdk/src/host/handshake.ts#L344-L348)). |
| The client's capabilities | `InitializeParams.capabilities`, today only `mcpApps` | Not kept anywhere. |
| The path the socket opened | `Opened.url` ([`code://packages/sdk/src/types/listen.ts#L40-L56`](../../packages/sdk/src/types/listen.ts#L40-L56)) | `accept` drops it ([`code://packages/sdk/src/host.ts#L2235-L2258`](../../packages/sdk/src/host.ts#L2235-L2258)). |
| The node whose token admitted it | `Opened.node` | `accept` drops it. |
| The sessions it is present in | `presence`, read by `activeClientsOf` ([`code://packages/sdk/src/host.ts#L1400`](../../packages/sdk/src/host.ts#L1400)) | Keyed by session, with no lookup by connection. |
| The bytes queued to send | `peer.buffered()` on all three runtimes ([`code://packages/sdk/src/listen.ts#L480-L496`](../../packages/sdk/src/listen.ts#L480-L496)), limited by `clientQueueBytes` ([`code://packages/sdk/src/host.ts#L2268-L2271`](../../packages/sdk/src/host.ts#L2268-L2271)) | Read for the limit, never for a row. |

`Opened.url` holds the query too, and the query can carry the token as `?tkn=` ([`code://packages/sdk/src/listen.ts#L75-L83`](../../packages/sdk/src/listen.ts#L75-L83)).
`pathOf` already cuts the query off ([`code://packages/sdk/src/listen.ts#L129-L133`](../../packages/sdk/src/listen.ts#L129-L133)).

### Not collected

- The time of the last frame in each direction. The tap sees every frame ([`code://packages/server/src/commands/run.ts#L846-L860`](../../packages/server/src/commands/run.ts#L846-L860)), but keeps counts only.
- The last `ping`. The handler answers `null` and records nothing ([`code://packages/sdk/src/host/handshake.ts#L560`](../../packages/sdk/src/host/handshake.ts#L560)).
- A round trip. The host never pings the client, so it has nothing to time.
- How the connection came in. `initialize` and `reconnect` both call `clientsChanged` with no mark of which one it was ([`code://packages/sdk/src/host/handshake.ts#L574-L637`](../../packages/sdk/src/host/handshake.ts#L574-L637)).
- `User-Agent` and `Origin`. Each runtime reads `X-Forwarded-For` at the upgrade and no other header ([`code://packages/sdk/src/listen.ts#L283-L289`](../../packages/sdk/src/listen.ts#L283-L289), [`code://packages/sdk/src/listen.ts#L371-L393`](../../packages/sdk/src/listen.ts#L371-L393), [`code://packages/sdk/src/listen.ts#L480-L496`](../../packages/sdk/src/listen.ts#L480-L496)).
- The count of requests the host refused on the connection.

### The screenshot row has no name

ahpc sends `clientInfo: { name: 'ahpc' }`, so its row should carry `name: 'ahpc'`.
The row Softov saw on 2026-11-14 had no name, so ahpw titled it by its client id.
The cause is not known; see *Open points*.

## Who writes

| Writer | Files it touches | What this change does to it |
|---|---|---|
| `main` | All of them | The base. |
| `plugin/20261114-1455-a-bot-talk-needs-no-grant` (2 ahead, 1 behind) | `docs/plugins/PLUGINS.md`, away from the `x-ahpd-clients` section | Both add text to one file in different sections. A merge should be clean. |
| `host/20261101-0329-maycxc-union` (2117 behind) | `host.ts`, `host/handshake.ts`, `types/host.ts`, `PLUGINS.md` | A stale union branch. It predates the clients channel, so it is not a target. |
| `fork/host-124-shell-integration` (2751 behind) | `host.ts`, `types/host.ts` | Stale. Not a target. |
| ahpw | Reads the row | New fields are additive. ahpw ignores a field it does not know. |

The uncommitted files in the main checkout are two briefs and a plugin plan, none of them code this change touches.

## The change

### Sent from what the host holds

- A row carries `root: true` when the socket came in on the deployment token.
- A row carries `principalUntil` when the sign-in has an expiry.
- A row carries `roles` and `team` beside `principal` when the connection signed in.
- A row carries `clientVersion` and `clientTitle` from `clientInfo` when the client sent them. They are kept by client id, as `clientNames` is, so a `reconnect` keeps them.
- A row carries `capabilities`, the names of the capabilities the client declared at `initialize`.
- A row carries `path`, the path the socket opened on, through `pathOf`. It never carries the query, because the query can hold the token.
- A row carries `node` when a node's own token admitted the socket.
- A row carries `authenticated`, the resource ids of the tokens the client pushed. It never carries a token.
- A row carries `sessions`, the URIs of the sessions the connection is present in.
- A row carries `queuedBytes`, what the peer has buffered to send, and `queueLimit`, the limit the host holds it to.

### Collected, then sent

- The tap stamps `lastIn` and `lastOut`, the wall-clock time of the last frame in each direction, beside the counts.
- `ping` stamps `lastPing` on the connection.
- The connection records `arrival`: `initialize` or `reconnect`.
- Each runtime reads `User-Agent` and `Origin` at the upgrade, into `Opened`. Each is a claim kept as sent, as `forwardedFor` is.
- The row carries `refused`, the count of requests the host answered with an error.

### How it is sent

- Only an arrival and a departure refresh the list at once ([`code://packages/server/src/commands/run.ts#L2107-L2109`](../../packages/server/src/commands/run.ts#L2107-L2109)).
- The 5-second tick refreshes every row while the list has a reader.
- So a field that `authenticate` or a subscription changes reaches a reader within 5 seconds.
- So every new field goes out with the counters, and the change adds no new refresh.
- `client:read` still gates the whole list. No field needs a second grant.
- `PLUGINS.md` names each new field, and says which ones are claims.
- `ConnectedClient` gains the fields that come from the connection, so a plugin that reads the registry sees them too.

## Open points

- Which fields go in the first plan. The suggested first cut is `root`, `clientVersion`, `lastIn` and `lastOut`, which answer "who is this and is it alive".
- Whether a round trip is worth a host ping. The host would send a WebSocket ping frame per socket on the tick. The protocol `ping` is the client's, so the host cannot use it.
- Whether `sessions` is cheap enough to build on each refresh, or needs a map from connection to sessions.
- Where `refused` is counted. The RPC layer answers the errors, and it has not been checked which layer sees the connection.
- Why the row Softov saw had no name. Check on a running daemon whether ahpc at f20c948 gets `name: 'ahpc'`, and whether the daemon in the screenshot is older than the name.
- Whether TLS facts belong here. The daemon is usually reached through a tunnel, so a listener-side TLS version would describe the tunnel, not the client.
