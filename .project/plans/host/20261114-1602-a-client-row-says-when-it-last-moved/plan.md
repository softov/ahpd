---
title: A client row says when it last moved
domain: host
status: planned
priority: medium
created: 2026-11-14
revalidated: 2026-11-14
requires:
  - plans/host/20261114-1602-a-client-row-sends-what-the-host-holds/plan.md
refs:
  - briefs/a-client-row-says-more-of-its-connection.md - the research, the references and the field names, not yet committed
  - "[code://packages/server/src/commands/run.ts#L846-L860](../../../../packages/server/src/commands/run.ts#L846-L860) - the tap, which counts frames and bytes per socket"
  - "[code://packages/sdk/src/clients/channel.ts#L50-L59](../../../../packages/sdk/src/clients/channel.ts#L50-L59) - `ClientCounts`, what the tap hands the channel"
  - "[code://packages/sdk/src/clients/channel.ts#L91-L101](../../../../packages/sdk/src/clients/channel.ts#L91-L101) - `rowOf`, which spreads the counts onto the row"
  - "[code://packages/sdk/src/host/handshake.ts#L560](../../../../packages/sdk/src/host/handshake.ts#L560) - `ping`, which answers `null` and records nothing"
  - "[code://packages/sdk/src/host/handshake.ts#L328-L351](../../../../packages/sdk/src/host/handshake.ts#L328-L351) - `initialize`, where the connection is named"
  - "[code://packages/sdk/src/host/handshake.ts#L574-L637](../../../../packages/sdk/src/host/handshake.ts#L574-L637) - `reconnect`, the second way in"
  - "[code://packages/sdk/src/host.ts#L2422](../../../../packages/sdk/src/host.ts#L2422) - the connection's `handle`, which every request passes"
  - "[code://packages/sdk/src/rpc.ts#L325-L343](../../../../packages/sdk/src/rpc.ts#L325-L343) - `receive`, which answers a thrown handler with an error and knows no connection"
  - "[code://packages/sdk/src/types/listen.ts#L40-L56](../../../../packages/sdk/src/types/listen.ts#L40-L56) - `Opened`, which gains the two headers"
  - "[code://packages/sdk/src/listen.ts#L53-L66](../../../../packages/sdk/src/listen.ts#L53-L66) - `openedOf`, shared by the three runtimes"
  - "[code://packages/sdk/src/listen.ts#L283-L314](../../../../packages/sdk/src/listen.ts#L283-L314) - Bun reads the request at the upgrade and carries it on `ws.data`"
  - "[code://packages/sdk/src/listen.ts#L371-L393](../../../../packages/sdk/src/listen.ts#L371-L393) - Deno reads the request at the upgrade"
  - "[code://packages/sdk/src/listen.ts#L480-L496](../../../../packages/sdk/src/listen.ts#L480-L496) - Node reads the request on `connection`"
  - "[code://packages/sdk/src/listen.ts#L761-L766](../../../../packages/sdk/src/listen.ts#L761-L766) - `NodeRequest`, typed with two headers only"
  - "[code://packages/sdk/test/listen-identity.test.ts](../../../../packages/sdk/test/listen-identity.test.ts) - the tests of what a socket reports"
  - "[code://docs/plugins/PLUGINS.md#L1874-L1890](../../../../docs/plugins/PLUGINS.md#L1874-L1890) - the `x-ahpd-clients` section"
---

## Goal

An operator reads whether a connection is alive and well, not only who it is.
A row says when a frame last crossed each way, when the client last pinged, and whether it came in fresh or resumed.
It also says how many of its requests the host refused, and the `User-Agent` and `Origin` it opened with.
Plan [A client row sends what the host holds](../20261114-1602-a-client-row-sends-what-the-host-holds/plan.md) comes first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "traffic" packages/server/src/commands/run.ts` - one map of counts per socket, written by the tap and deleted on a departure.
- `rg "ping" packages/sdk/src/host/handshake.ts` - one handler, which answers `null`.
- `rg "clientsChanged" packages/sdk/src/host/handshake.ts` - `initialize` and `reconnect` say the arrival the same way.
- `rg "error: \{" packages/sdk/src/rpc.ts` - a thrown handler is answered in `receive`, which holds the peer and not the connection.
- `rg "x-forwarded-for" packages/sdk/src/listen.ts` - each runtime reads one header at the upgrade, in its own branch.
- `rg -i "tls|cert" packages/sdk/src/listen.ts` - the listener speaks no TLS.

### Runtime path

```
frame -> tap (lastIn, lastOut) -> counters
ping / initialize / reconnect -> Connection (lastPing, arrival)
request -> handle throws -> Connection.refused
upgrade -> Opened (userAgent, origin) -> accept -> Connection
all -> clientRow / rowOf -> tick refresh -> reader
```

### Gaps

- The tap keeps no time.
- `ping`, `initialize` and `reconnect` record nothing a row can read.
- Nothing counts refusals per connection.
- No runtime reads `User-Agent` or `Origin`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| No round trip: the host sends no ping of its own | Softov, 2026-11-14: "Leave it out" | - |
| `User-Agent` and `Origin` are read at the upgrade on all three runtimes | Softov, 2026-11-14: "Include both" | 02 |
| No TLS fields | [code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) speaks no TLS `(defaulted: nothing to read)` | - |
| `lastIn` and `lastOut` are wall-clock milliseconds kept in `ClientCounts`, beside the counts | `(defaulted: the tap already holds one entry per socket)` | 01 |
| The tap's sums move into `countFrame` in `clients/channel.ts`, which the tap calls | `(defaulted: no test covers the daemon's tap, and the SDK suite can test a function)` | 01 |
| `lastPing` is a wall-clock millisecond on `Connection`, set by `ping` | `(defaulted: the handshake holds the connection)` | 01 |
| `arrival` is `initialize` or `reconnect`, the last introduction on the socket | `(defaulted: the two ways in the handshake names)` | 01 |
| `refused` counts the requests whose handler threw, in the connection's `handle` | `(defaulted: receive in rpc.ts knows no connection)` | 01 |
| `userAgent` and `origin` are kept as sent, as `forwardedFor` is | `(defaulted: the same kind of claim)` | 02 |
| No new refresh: every field reaches a reader on the 5-second tick | [code://packages/server/src/commands/run.ts#L2107-L2109](../../../../packages/server/src/commands/run.ts#L2107-L2109) | 01, 02 |

## Proposed architecture

- **Data flow** - the tap stamps the time beside the counts. The handshake stamps `lastPing` and `arrival` on the connection. The connection's `handle` counts a throw. Each runtime puts the two headers into `Opened`, and `accept` keeps them. `clientRow` copies the connection's fields, and `rowOf` spreads the counts as it does now.
- **Event flow** - unchanged.
- **State flow** - five new `Connection` fields: `lastPing`, `arrival`, `refused`, `userAgent` and `origin`. Two new `ClientCounts` fields. Nothing is stored on disk.
- **Layer responsibilities** - `@ahpd/sdk` listen: the headers. `@ahpd/sdk` host: the connection fields and the count. `@ahpd/server`: the tap's times. docs: the field list.
- **Source-of-truth files** - [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) for `ConnectedClient`, and [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) for the row.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The row says when it last moved](task-01-the-row-says-when-it-last-moved.md) | todo | - |
| [02 - The row carries the upgrade headers](task-02-the-row-carries-the-upgrade-headers.md) | todo | - |

## Risks and tradeoffs

- `lastIn` and `lastOut` move on nearly every tick, so a busy row is sent each 5 seconds - the counters already do this.
- `Date.now()` on every frame costs a little on the tap's path - the tap already measures each frame's bytes there.
- A `User-Agent` can be long - it is kept as sent, as `forwardedFor` is, and only `client:read` reads it.
- Bun and Deno headers can be checked only by hand - the plan before this one left the same check waiting.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-row-says-when-it-last-moved.md](task-01-the-row-says-when-it-last-moved.md), once the plan it requires is built.
- **Open questions:** none.
- **Watch out for:** the tap's counts are deleted on a departure, so the times go with them. A notification that throws is counted too, though `receive` answers nothing.

## Final verification checklist

- [ ] A row's `lastIn` and `lastOut` move when a frame crosses, and reach a reader within 5 seconds.
- [ ] A row carries `lastPing` after the client pings.
- [ ] A row carries `arrival: 'initialize'` on a new socket, and `arrival: 'reconnect'` after a reconnect.
- [ ] A row's `refused` grows by one for each refused request.
- [ ] A row carries `userAgent` and `origin` on Node, and by hand on Bun and Deno.
- [ ] `pnpm --filter @ahpd/sdk test`, `pnpm --filter @ahpd/server test`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- [ ] `PLUGINS.md` names every new field, and says which ones are claims.
