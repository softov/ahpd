---
title: A client row sends what the host holds
domain: host
status: built
priority: medium
created: 2026-11-14
revalidated: 2026-11-14
refs:
  - briefs/a-client-row-says-more-of-its-connection.md - the research, the references and the field names, not yet committed
  - plans/host/20261103-0321-a-client-is-listed-and-dropped/plan.md - the plan that built `x-ahpd-clients://`, which this one extends
  - "[code://packages/sdk/src/types/host.ts#L179-L200](../../../../packages/sdk/src/types/host.ts#L179-L200) - `ConnectedClient`, the row's shape, which gains the new fields"
  - "[code://packages/sdk/src/types/host.ts#L2015-L2117](../../../../packages/sdk/src/types/host.ts#L2015-L2117) - `Connection`, which holds `root`, `principalUntil` and `tokens`"
  - "[code://packages/sdk/src/host.ts#L1973-L1984](../../../../packages/sdk/src/host.ts#L1973-L1984) - `clientRow`, read at each refresh, the one place a field joins the row"
  - "[code://packages/sdk/src/host.ts#L461-L464](../../../../packages/sdk/src/host.ts#L461-L464) - `clientNames` and `clientVersions`, the by-client-id maps a new map copies"
  - "[code://packages/sdk/src/host/context.ts#L189](../../../../packages/sdk/src/host/context.ts#L189) - where the maps reach the handshake"
  - "[code://packages/sdk/src/host/handshake.ts#L344-L348](../../../../packages/sdk/src/host/handshake.ts#L344-L348) - `initialize` keeps `clientInfo.name` only"
  - "[code://packages/sdk/src/host/handshake.ts#L121-L134](../../../../packages/sdk/src/host/handshake.ts#L121-L134) - `attached`, which forgets each by-client-id map past the retention"
  - "[code://packages/sdk/src/host/handshake.ts#L947-L953](../../../../packages/sdk/src/host/handshake.ts#L947-L953) - a pushed token, kept under a key with its `resource`"
  - "[code://packages/sdk/src/clients/channel.ts#L91-L101](../../../../packages/sdk/src/clients/channel.ts#L91-L101) - `rowOf`, which turns `principal` into its id"
  - "[code://packages/sdk/src/types/users.ts#L42-L62](../../../../packages/sdk/src/types/users.ts#L42-L62) - `Principal.roles` and `Principal.team`"
  - "[code://packages/sdk/src/types/listen.ts#L40-L56](../../../../packages/sdk/src/types/listen.ts#L40-L56) - `Opened`, which gains `path`"
  - "[code://packages/sdk/src/listen.ts#L53-L66](../../../../packages/sdk/src/listen.ts#L53-L66) - `openedOf`, shared by the three runtimes, where `path` is cut"
  - "[code://packages/sdk/src/listen.ts#L129-L133](../../../../packages/sdk/src/listen.ts#L129-L133) - `pathOf`, the URL without its query"
  - "[code://packages/sdk/src/listen.ts#L75-L83](../../../../packages/sdk/src/listen.ts#L75-L83) - `presented`, which reads the token from `?tkn=`, the reason the query never leaves"
  - "[code://packages/sdk/src/host.ts#L2235-L2258](../../../../packages/sdk/src/host.ts#L2235-L2258) - `accept`, which keeps `socket`, `address` and `forwardedFor` from `Opened`"
  - "[code://packages/sdk/src/host.ts#L2268-L2271](../../../../packages/sdk/src/host.ts#L2268-L2271) - the peer's queue limit, `clientQueueBytes(ctx.rootConfig)`"
  - "[code://packages/sdk/src/types/rpc.ts#L100-L107](../../../../packages/sdk/src/types/rpc.ts#L100-L107) - `Peer.buffered`, the bytes the wire still holds"
  - "[code://packages/sdk/src/host.ts#L274-L289](../../../../packages/sdk/src/host.ts#L274-L289) - `presence`, who is in each session, by session id and then client id"
  - "[code://packages/sdk/src/host.ts#L2562](../../../../packages/sdk/src/host.ts#L2562) - `ctx.nameOf`, which turns a session id in `presence` back into its URI"
  - "[code://packages/server/src/commands/run.ts#L2107-L2109](../../../../packages/server/src/commands/run.ts#L2107-L2109) - only an arrival and a departure refresh the list at once"
  - "[code://packages/sdk/test/clients-channel.test.ts](../../../../packages/sdk/test/clients-channel.test.ts) - the channel's tests, which take a registry by hand"
  - "[code://packages/sdk/test/host-handshake.test.ts#L386-L394](../../../../packages/sdk/test/host-handshake.test.ts#L386-L394) - tests that read `clientRegistry.connected()` after a real handshake"
  - "[code://docs/plugins/PLUGINS.md#L1874-L1890](../../../../docs/plugins/PLUGINS.md#L1874-L1890) - the `x-ahpd-clients` section"
  - https://github.com/softov/agent-host-protocol/blob/2c37a04fc5d220d3d4d4c9155ac1fb3e1b0a1dae/types/common/commands.ts#L124-L232 - `Implementation` and `ClientCapabilities`, checked at 2c37a04f
---

## Goal

An operator who opens a connection on `x-ahpd-clients://` reads everything the host already knows about it.
Today a row on the deployment token and an anonymous row look the same.
The host also holds the client's version, capabilities, sessions and send queue, and sends none of them.
This plan sends what the host holds.
Plan [A client row says when it last moved](../20261114-1602-a-client-row-says-when-it-last-moved/plan.md) records what it does not hold yet.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "clientsChanged|clientWatchers" packages/sdk/src` - only `initialize`, `reconnect` and a departure say a change.
- `rg "clientRegistry" packages/server/src/commands/run.ts` - the watch refreshes the list on a change, and the 5-second tick refreshes it while it has a reader.
- `rg "opened\?\.url|opened\.url" packages/sdk/src/host.ts` - nothing in the host reads `Opened.url`.
- `rg "tokens.set\(" packages/sdk/src` - one writer, in `handshake.ts`, and each value carries its `resource`.
- `rg "presence" packages/sdk/src/host.ts` - keyed by session id, then by client id.
- `rg "x-ahpd-clients|clients channel" .project/specs .project/decisions .project/rules` - nothing.

### Runtime path

```
listener (Opened) -> host.accept (Connection) -> initialize (by-client-id maps) -> clientRow (ConnectedClient) -> clientsChannel.rowOf (row) -> tick refresh -> reader
```

### Gaps

- `clientRow` copies no `root`, `principalUntil`, `tokens`, `path` or `node`.
- `initialize` keeps no `clientInfo.version`, `clientInfo.title` or `capabilities`.
- `Opened` has no `path`; its `url` carries the query, which can hold the token.
- No lookup goes from a client to the sessions it is present in.
- `rowOf` sends `principal.id` and drops the roles and team.
- The row Softov saw had no `name` though ahpc sends one. `Not found: a cause - searched handshake.ts, host.ts and the reconnect path.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| Two plans: this one sends the held fields, the next records the collected ones | Softov, 2026-11-14: "Two plans, held then collected" | 01, 02 |
| A row's new fields are flat on the row, as `name` and `address` are | `(defaulted: the row is flat today, and ahpw reads it flat)` | 01, 02 |
| `principal` stays the id; `roles` and `team` are fields beside it | `(defaulted: ahpw reads principal as a string)` | 01 |
| `root: true` only when the socket came in on the deployment token, and absent otherwise | [code://packages/sdk/src/host.ts#L2257](../../../../packages/sdk/src/host.ts#L2257) | 01 |
| `clientVersion`, `clientTitle` and `capabilities` are kept by client id, as `clientNames` is, and forgotten with it | `(defaulted: a reconnect carries no clientInfo, so a by-connection copy would be lost on reconnect)` | 01 |
| `capabilities` is the list of the capability names the client declared | `(defaulted: each capability is a presence flag in the protocol)` | 01 |
| `path` is cut by `pathOf` in `openedOf`; `url` is never sent | `(defaulted: the query can carry the token as ?tkn=)` | 02 |
| `authenticated` is the distinct `resource` of each pushed token; a token never leaves | `(defaulted: the resource names the service, the token is a secret)` | 02 |
| `sessions` are the URIs of the sessions whose `presence` holds the row's client id | `(defaulted: presence is keyed by client id, as the protocol's reducer is)` | 02 |
| `queuedBytes` is `peer.buffered()`; `queueLimit` is `clientQueueBytes(ctx.rootConfig)`; each is absent when unknown | [code://packages/sdk/src/host.ts#L2268-L2271](../../../../packages/sdk/src/host.ts#L2268-L2271) | 02 |
| No new refresh: every field reaches a reader on the 5-second tick | [code://packages/server/src/commands/run.ts#L2107-L2109](../../../../packages/server/src/commands/run.ts#L2107-L2109) | 01, 02 |
| `client:read` still gates the whole list | `(defaulted: no field is a secret)` | 01, 02 |
| The missing `name` is checked by hand on a running daemon, and fixed in task 01 if the cause is in the host | `(defaulted: the cause is unknown)` | 01 |

## Proposed architecture

- **Data flow** - each listener cuts `path` into `Opened`. `accept` keeps `path` and `node` on the `Connection`. `initialize` keeps the client's version, title and capabilities by client id. `clientRow` reads all of it, with the queue, the tokens and `presence`, at each call.
- **Event flow** - unchanged: an arrival and a departure refresh at once, and the tick refreshes while the list has a reader.
- **State flow** - one new by-client-id map, `clientInfos`, beside `clientNames`, forgotten in `attached`. Two new `Connection` fields, `path` and `node`. Nothing is stored on disk.
- **Layer responsibilities** - `@ahpd/sdk` listen: `Opened.path`. `@ahpd/sdk` host: the connection, the maps and `clientRow`. `@ahpd/sdk` clients: `rowOf` adds the principal's roles and team. docs: the field list.
- **Source-of-truth files** - [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) for `ConnectedClient`, and [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) for the row.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The row says who and which client](task-01-the-row-says-who-and-which-client.md) | done | - |
| [02 - The row says where and what it holds](task-02-the-row-says-where-and-what-it-holds.md) | done | 01 |

## Risks and tradeoffs

- `sessions` scans `presence` once per row per refresh - the map holds only sessions with a client in them, and refreshes come 5 seconds apart.
- `roles` tells a reader the role names of each person connected - `client:read` already says who is connected, and a role name grants nothing.
- `capabilities` and `clientVersion` are the client's claims - `PLUGINS.md` says so, as it does for `forwardedFor`.
- A field set at `authenticate` reaches a reader up to 5 seconds late - the list already works this way for `principal` and `subscriptions`.

## Resume state

- **Done so far:** both tasks. Task 01 sent `root`, `principalUntil`, `clientVersion`, `clientTitle`, `capabilities`, `roles` and `team`. Its by-hand check found the missing `name` in ahpc's client library, not the host. Task 02 sent `path`, `node`, `authenticated`, `sessions`, `queuedBytes` and `queueLimit`.
- **Next action:** none; built on 2026-11-14. Plan [A client row says when it last moved](../20261114-1602-a-client-row-says-when-it-last-moved/plan.md) is next.
- **Open questions:** none.
- **Watch out for:** never send `Opened.url`, because its query can carry the token. `clientRow` is the only place a field joins the row; `rowOf` only reshapes `principal`.

## Final verification checklist

- [ ] A row on the deployment token carries `root: true`, and an anonymous row carries no `root`.
- [ ] A row carries `clientVersion`, `clientTitle` and `capabilities` after `initialize`, and keeps them after `reconnect`.
- [ ] A row carries `path`, never a query, for a socket opened with `?tkn=`.
- [ ] A row carries `authenticated` with resources and no token after `authenticate`.
- [ ] A row carries `sessions` while the client is present in a session.
- [ ] `pnpm --filter @ahpd/sdk test`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- [ ] `PLUGINS.md` names every new field.
- [ ] The brief is deleted once this plan and the next one cover it, with a `git://` ref to its last commit.
