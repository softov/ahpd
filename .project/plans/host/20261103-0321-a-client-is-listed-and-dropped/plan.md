---
title: A client is listed and dropped
domain: host
status: planned
priority: medium
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://8ad9bbae3b3ecc04174f382fab3340913b7d8533 - the last commit that holds the brief `briefs/a-client-is-listed-and-dropped.md`, with the research and the answers
  - plans/plugin/20261102-1122-the-host-keeps-the-tunnels/plan.md - the operations core and the tunnels channel, which this channel copies
  - "[code://packages/sdk/src/types/listen.ts#L38-L56](../../../../packages/sdk/src/types/listen.ts#L38-L56) - `Opened` and `OnConnect`, the seam the address arrives on"
  - "[code://packages/sdk/src/listen.ts#L54-L57](../../../../packages/sdk/src/listen.ts#L54-L57) - `openedOf`, which builds `Opened` for each runtime"
  - "[code://packages/sdk/src/listen.ts#L90-L101](../../../../packages/sdk/src/listen.ts#L90-L101) - `tapping`, which numbers each accepted socket"
  - "[code://packages/sdk/src/types/host.ts#L1300-L1413](../../../../packages/sdk/src/types/host.ts#L1300-L1413) - `Connection`, which holds no address and no connect time"
  - "[code://packages/sdk/src/types/host.ts#L81-L119](../../../../packages/sdk/src/types/host.ts#L81-L119) - `JoinedNode` and `NodeRegistry`, the registry shape this one copies"
  - "[code://packages/sdk/src/host.ts#L1999-L2043](../../../../packages/sdk/src/host.ts#L1999-L2043) - `accept`, where a connection joins the set"
  - "[code://packages/sdk/src/host.ts#L2328-L2343](../../../../packages/sdk/src/host.ts#L2328-L2343) - `close`, where a connection leaves the set"
  - "[code://packages/sdk/src/kinds/operations.ts#L79-L95](../../../../packages/sdk/src/kinds/operations.ts#L79-L95) - `targetOf`, which knows the `tunnel` scope only"
  - "[code://packages/sdk/src/types/kinds.ts#L25](../../../../packages/sdk/src/types/kinds.ts#L25) - `OperationScope`, which is `list` or `tunnel`"
  - "[code://packages/sdk/src/tunnels/channel.ts#L307-L345](../../../../packages/sdk/src/tunnels/channel.ts#L307-L345) - a records channel over a source of its own, with `operations` in its snapshot"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L27-L32](../../../../packages/sdk/src/resources/recordschannel.ts#L27-L32) - `RecordsSource`, the two calls a live source answers"
  - "[code://packages/server/src/commands/run.ts#L741](../../../../packages/server/src/commands/run.ts#L741) - the daemon's one `Tap`, which writes the wire capture today"
  - "[code://packages/server/src/commands/run.ts#L930-L947](../../../../packages/server/src/commands/run.ts#L930-L947) - the tunnels channel and `invokeOperation`, built before the host"
  - "[code://packages/server/src/commands/run.ts#L1045-L1049](../../../../packages/server/src/commands/run.ts#L1045-L1049) - `servedRecords`, which serves each host channel and command"
  - "[code://packages/server/src/commands/run.ts#L1903-L1918](../../../../packages/server/src/commands/run.ts#L1903-L1918) - `acceptConnection`, which drops `opened` before `host.accept`"
  - "[code://docs/plugins/PLUGINS.md#L1683](../../../../docs/plugins/PLUGINS.md#L1683) - the `x-ahpd-tunnels` section, which the clients section copies"
  - https://bun.sh/docs/api/http#server-requestip-request - `server.requestIP(request)`, which answers `{ address, port }` or null
  - https://docs.deno.com/api/deno/~/Deno.ServeHandlerInfo - `remoteAddr`, on the second argument of a `Deno.serve` handler
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/protocolServerHandler.ts#L457-L475 - the reference host's connected client record, which it does not publish
---

## Goal

An operator sees which clients a daemon serves, and drops one.
Each client is a row on `x-ahpd-clients://`, with its id, name, address, protocol version and person.
A row also holds the connect time, and the frames and bytes in each direction.
Drop is an operation on a row, so a client draws the button from the state with no code for it.
Today a connection is said once, in a log line at its handshake, and nothing else reports it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git diff --stat f419294d a8eff676` over the brief's files - no change, so the brief's facts hold at 8ad9bbae.
- `git branch -r --no-merged` over `types/host.ts`, `host/handshake.ts`, `host/context.ts`, `types/listen.ts` and `listen.ts` - fork branches change other parts of `types/host.ts` and `handshake.ts`, and none touches `Connection`, `accept` or the listener.
- `rg "connections\.(add|delete)" packages/sdk/src` - `host.ts` is the one place a connection joins and leaves.
- `rg "tap" packages/server/src/commands/run.ts` - one `Tap` for the daemon, keyed by the socket number `tapping` gives.
- `rg "OperationScope|targetOf" packages/sdk/src` - the operations core takes a target for the `tunnel` scope only.

### Runtime path

```
listener accepts a socket -> Opened { socket, address, forwardedFor } -> host.accept -> Connection
  -> client registry: arrival -> clients channel refresh -> each reader of x-ahpd-clients:// sees the row
daemon Tap(from, text, socket) -> counters by socket -> clients channel refresh, at most each 5 s
x-ahpd/invokeOperation { channel: x-ahpd-clients://, operationId: drop, target: { id } }
  -> client:drop checked -> answer the row -> close that peer -> departure -> row removed
```

### Gaps

- `Opened` has no socket number, no address and no forwarded value.
- `acceptConnection` passes `opened` to the node registry only, so `host.accept` never sees it.
- `Connection` has no address and no connect time.
- The host has no registry of its connections that a channel can read and watch.
- `targetOf` refuses any target scope other than `tunnel`.
- `Not found: a count of frames or bytes per connection - searched "bytes", "frames", "count" in packages/sdk/src/listen.ts and packages/server/src/commands/run.ts.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| `client:read` reads the channel and `client:drop` drops a client, as `tunnel:read` and `tunnel:delete` do | Softov, 2026-11-02, chose "Two grants" | 02 |
| Drop is an operation in the state of `x-ahpd-clients://`, run with `x-ahpd/invokeOperation` and `target: { id }` | Softov, 2026-11-02, chose "An operation" | 02 |
| A row holds the socket address, and the `X-Forwarded-For` value in a field of its own, named as a claim | Softov, 2026-11-02, chose "Both, labelled" | 01 |
| A drop closes the socket and nothing more. The client may reconnect at once, and a revoked token keeps it out | Softov, 2026-11-02, chose "Yes, a drop is no ban" | 02 |
| A caller that drops its own connection gets the answer, and then the socket closes | Softov, 2026-11-02, chose "Answer, then close" | 02 |
| The first counters are frames and bytes in each direction, from `Tap`. Sessions, messages and events come in a later change | Softov, 2026-11-02, chose "Packets and bytes" | 03 |
| The rows come from a live client registry, which the records channel helper reads as its source, as the tunnels channel reads its own | (defaulted: the registry knows the sockets now, and the helper already sends each reader its diff) | 02 |
| A row's id is the socket number the listener gives, as a string. The client id is a field, because two sockets may share one during a reconnect | (defaulted: one id for one socket, and `Tap` already keys by that number) | 01 |
| The forwarded field is `forwardedFor`, the header's text as sent, and absent when the header is absent | (defaulted: a claim is kept as it came, and is never parsed into an address) | 01 |
| The drop operation has `id: drop`, `kind: host`, `scopes: ['client']`, a `confirmation`, and `client:drop` | (defaulted: the host declares it, and a destructive operation asks first, as a tunnel's `remove` does) | 02 |
| `targetOf` takes a target for every scope other than `list`, and names the scope in its refusal | (defaulted: the connector `ui` brief adds a `connector` scope next, and one rule serves all of them) | 02 |
| Counters reach readers at most once each 5 seconds, and only while the channel has a subscriber | (defaulted: a refresh on each frame would send a diff on each frame) | 03 |
| `?owner=me` is refused on this channel | (defaulted: no answer covers a person reading only their own clients, so the grant is the whole rule) | 02 |

## Proposed architecture

- **Data flow** - The listener builds `Opened` with the socket number, the address and `forwardedFor`. `host.accept` copies them to `Connection` with `connectedAt`. The registry answers one `ConnectedClient` for each connection.
- **Event flow** - The registry calls each watcher on an arrival and a departure. The channel refreshes on each call, and on a 5-second timer for the counters.
- **State flow** - Everything is in memory. A row exists while its socket is open. Counters are dropped with the row.
- **Layer responsibilities** - `@ahpd/sdk`: `Opened`, the listener, `Connection`, the registry on the host, the clients channel, the operations scope. `@ahpd/server`: the counters from `Tap`, and the wiring in `run.ts`. Docs: the `x-ahpd-clients` section of `PLUGINS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) for `ConnectedClient` and `ClientRegistry`. `packages/sdk/src/clients/channel.ts` for the channel, which task 02 creates.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A connection knows its address](task-01-a-connection-knows-its-address.md) | implemented | - |
| [02 - The host lists and drops its clients](task-02-the-host-lists-and-drops-clients.md) | todo | 01 |
| [03 - A row counts frames and bytes](task-03-a-row-counts-frames-and-bytes.md) | todo | 02 |

## Risks and tradeoffs

- The row shows each address to every holder of `client:read`. The grant is given to no role by default, so only the deployment token reads it at first.
- `forwardedFor` is a value the client may forge. The field name and the docs say it is a claim, and nothing in the host trusts it.
- The answer to a drop must be on the wire before the socket closes. The channel closes the peer after the answer is sent, not inside `run`.
- Bun and Deno have no test runner in CI. Their address calls are checked by hand where the runtime is installed, and the task says so in its *Resume*.
- Fork branches change other lines of `types/host.ts` and `handshake.ts`. Fetch `maycxc` before the build and rebase on what merged.

## Resume state

- **Done so far:** task 01 implemented. `Opened` and `Connection` hold the socket number, the address, the forwarded claim and the connect time, on all four transports, and `Host.clientRegistry.connected()` answers the rows.
- **Next action:** [task-02-the-host-lists-and-drops-clients.md](task-02-the-host-lists-and-drops-clients.md).
- **Open questions:** task 02 says to add `clients: ClientRegistry` to `Host`, and that name is taken by `Clients`, the resource-provider view. Its `watch(client, uri, options)` would clash with `ClientRegistry.watch(onChange)` on any merged type. The build used `clientRegistry`, named for its type as `HostOptions.nodes` is. If you want another name, it is one property and one export to rename.
- **Watch out for:** `acceptConnection` in `run.ts` and `overStdio` both call `host.accept` without `opened`. Pass it on both paths.

## Final verification checklist

- [ ] A client connected over WebSocket on Node is a row on `x-ahpd-clients://` with its address, version and connect time.
- [ ] A request with `X-Forwarded-For` shows that text in `forwardedFor`, and the socket address in `address`.
- [ ] A reader without `client:read` is refused the channel.
- [ ] `drop` without `client:drop` is refused, and with it the answer arrives before the socket closes.
- [ ] A dropped client reconnects at once and is a new row.
- [ ] Frames and bytes grow in each direction, and reach a reader within 5 seconds.
- [ ] `pnpm typecheck` and `pnpm --filter @ahpd/sdk test` pass, and `pnpm --filter @ahpd/server test` passes after them.
