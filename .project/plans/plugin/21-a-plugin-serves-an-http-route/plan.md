---
title: A plugin serves an HTTP route on the daemon's listener
domain: plugin
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/daemon/05-an-http-api/plan.md
  - plans/plugin/20-a-plugin-is-a-client-of-its-own-host/plan.md
changes: []
creates: []
decisions:
  - decisions/plugin-registration-kinds.md
  - decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md
  - decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L139-L279](../../../../packages/sdk/src/types/plugin.ts#L139-L279) - `PluginHost`, which gains `registerRoute`"
  - "[code://packages/sdk/src/types/plugin.ts#L329-L364](../../../../packages/sdk/src/types/plugin.ts#L329-L364) - `Contribution`, which gains the routes"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - the fold and the registration checks"
  - "[code://packages/sdk/src/types/listen.ts#L99-L112](../../../../packages/sdk/src/types/listen.ts#L99-L112) - the listener's plain-request handler"
  - "[code://packages/server/src/commands/run.ts#L341-L342](../../../../packages/server/src/commands/run.ts#L341-L342) - `daemonRequest`, the plain-request chain, built before the plugins load"
  - "[code://packages/server/src/commands/run.ts#L607](../../../../packages/server/src/commands/run.ts#L607) - `loadPlugins`, where the fold that holds the routes is made"
  - "[code://packages/server/src/commands/run.ts#L687](../../../../packages/server/src/commands/run.ts#L687) - the listener always gets `plainRequests(daemonRequest)`"
  - "[code://packages/server/src/commands/run.ts#L74-L86](../../../../packages/server/src/commands/run.ts#L74-L86) - `apiOrigins`, the names the API's Host check accepts, made only when `http` is on"
  - "[code://.project/plans/daemon/05-an-http-api/task-15-serve-takes-a-request.md](../../daemon/05-an-http-api/task-15-serve-takes-a-request.md) - `Request` in, `Response` out; done"
  - "[code://.project/plans/daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md](../../daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md) - the same on Bun and Deno; done"
  - "[code://.project/plans/daemon/05-an-http-api/task-11-origin-and-host-are-checked.md](../../daemon/05-an-http-api/task-11-origin-and-host-are-checked.md) - the Host check a route shares"
  - "[code://docs/PLUGINS.md#L358-L371](../../../../docs/PLUGINS.md#L358-L371) - \"HTTP routes are not, because there is no HTTP server\""
---

## Goal

A plugin that is called over HTTP, a webhook, a platform callback or a facade, is served on the daemon's own listener under `/plugins/<name>/`, so a tunnel carries it and no second port is opened.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "request\?:" packages/sdk/src/types/listen.ts` - the listener takes one plain-request handler, given to the HTTP API.
- `rg -n "registerRoute" packages .project` - nothing.

### Runtime path

```
apply -> [new] registerRoute(handler) -> Contribution.routes -> fold
listener: plainRequests(daemonRequest) -> tools servers -> [new] /plugins/<encoded name>/... -> Host check -> handler(Request) -> Response
                                       -> /api -> the HTTP API, as today
```

### Gaps

- No registration kind for a route, and the domain reference says there is none because there was no HTTP server.
- The listener hands every plain request to `daemonRequest`, which is built before the plugins load, so a route is read from the fold per request.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin registers from a closed set of kinds, one register method each, and every registration is checked](../../../decisions/plugin-registration-kinds.md) | a route is a new row in that set |
| 2 | [cofold's serve() takes a Request and answers a Response, and Node gets an adapter](../../../decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md) | the handler shape a route shares |
| 3 | [The HTTP API checks Origin and Host, and takes only JSON bodies](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) | the guards, of which a route takes only Host |

| What | Source | Task |
| --- | --- | --- |
| `registerRoute(handler: (request: Request) => Promise<Response>)`, one per plugin, served under `/plugins/<name>/` | Softov, 2026-09-26 | 01, 02 |
| The fold's field is `routes`, keyed by plugin name, and `Contribution.routes` carries a plugin's | (defaulted: one spelling, the plan's) | 01 |
| The prefix is the plugin's name with each `/`-separated segment percent-encoded, matched by whole segments; no name is refused for its shape | (defaulted: a throw from a register method discards the plugin's whole contribution) | 01, 02 |
| The Host check applies to a route; the Origin and JSON-only checks do not, and the route authenticates its own caller | Softov, 2026-09-26 | 02 |
| A route's Host check accepts the names `apiOrigins` gives plus the host a tunnel announces, and the list is built whether `http` is on or off | Softov, 2026-10-04 | 02 |
| The tunnel's host is learnt from the listener's announcements: each `scheme://` URL a plugin says adds its host and hostname; `@ahpd/tunnel-devtunnel` announcing its URL is a follow-up outside this plan | Softov, 2026-10-04 | 02 |
| Routes are served whenever a plugin registers one, with `http` on or off | Softov, 2026-09-26 | 02 |
| What a route does on the host goes through its plugin's connection, so the plugin's grants apply; this plan is built before plan 20, and a route gains the connection when plan 20 lands | [plan 20](../20-a-plugin-is-a-client-of-its-own-host/plan.md), Softov, 2026-10-04 | - |
| Builds on daemon 05 tasks 15 and 16, done, so a route runs on Node, Bun and Deno | Softov, 2026-09-26 | 02 |
| The registration kinds table, the "not a kind" line and `docs/PLUGINS.md` gain the route | decision 1 | 03 |

## Proposed architecture

- **Data flow** - the request's path below `/plugins/<name>` reaches the handler unchanged; its `Response` goes back as it is.
- **Event flow** - none.
- **State flow** - none; a route holds what its plugin holds.
- **Layer responsibilities** - `packages/sdk`: the kind, its check and its fold · `packages/server/src/commands/run.ts`: the prefix in `daemonRequest` and the Host check · `docs/PLUGINS.md` and `00-plugin.md`: the kind.
- **Source-of-truth files** - [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - registerRoute is a registration kind](task-01-register-route-is-a-kind.md) | implemented | - |
| [02 - The listener serves a plugin's route under /plugins/<name>/](task-02-the-listener-serves-routes.md) | implemented | 01, and the open question in Resume state |
| [03 - Docs](task-03-docs.md) | implemented | 02 |

## Risks and tradeoffs

- A route is reachable wherever the listener is, with no Bearer token in front of it - the route authenticates its caller, and the docs say so first.
- A slow handler holds a request open - it is the plugin's, as a slow event handler is.

## Resume state

- **Done so far:** all three tasks implemented 2026-10-04, and uncommitted for Softov's review.
- **Next action:** Softov's review. The close-out (`implemented.md`, `status: built`) waits on it, and `plans/index.md` was left alone.
- **Open questions:** none. Softov's three answers of 2026-10-04 are settled in the code: built before plan 20; the Host check takes `apiOrigins`' names plus the tunnel's host, built whether `http` is on or off; and the tunnel's host is learnt from the listener's announcements by `announcedNames` in `run.ts`, which reads each `scheme://` URL a plugin says and adds its `host` and `hostname`.
- **Departures from the plan, all small and all in the task files:** the route's `Host` list is built from `boundPort`, the daemon's own port, rather than from `apiOrigins`' `apiBoundPort`, because `http.port` moves the API to a listener of its own and must not move the route's names with it; a path under `/plugins/` that no loaded plugin registered is 404 rather than the 426 the rest of the listener gives; the fixture needed a `package.json` naming `./index.ts`, because a directory spec with no entry is skipped by the loader; and the whole `/plugins/` space is answered by every daemon, including one with no plugin that registered a route.
- **Watch out for:** the plugin's `name` can hold `@` and `/`, and the prefix encodes each segment rather than refusing a name - a throw there costs the plugin its whole contribution, so nothing about a name throws. The task 02 case for `Host: fixture-tunnel.example.com:443` is a 403 by design: what an announcement named is what answers, and that URL named no port.

## Final verification checklist

- [ ] A fixture plugin's route answers `POST /plugins/<name>/hook` with `http` off and with it on.
- [ ] The Host rule the open question settles holds; a request with no `Origin` and a non-JSON body reaches the route.
- [ ] `/api` is unchanged.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/PLUGINS.md`, `00-plugin.md`, `plans/index.md` updated.
