---
title: A plugin serves an HTTP route on the daemon's listener
domain: plugin
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
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
  - "[code://packages/sdk/src/types/plugin.ts#L118-L207](../../../../packages/sdk/src/types/plugin.ts#L118-L207) - `PluginHost`, which gains `registerRoute`"
  - "[code://packages/sdk/src/types/plugin.ts#L247-L282](../../../../packages/sdk/src/types/plugin.ts#L247-L282) - `Contribution`, which gains the routes"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - the fold and the registration checks"
  - "[code://packages/sdk/src/types/listen.ts#L95-L109](../../../../packages/sdk/src/types/listen.ts#L95-L109) - the listener's plain-request handler"
  - "[code://.project/plans/daemon/05-an-http-api/task-15-serve-takes-a-request.md](../../daemon/05-an-http-api/task-15-serve-takes-a-request.md) - `Request` in, `Response` out"
  - "[code://.project/plans/daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md](../../daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md) - the same on Bun and Deno"
  - "[code://.project/plans/daemon/05-an-http-api/task-11-origin-and-host-are-checked.md](../../daemon/05-an-http-api/task-11-origin-and-host-are-checked.md) - the Host check a route shares"
  - "[code://docs/PLUGINS.md#L185-L196](../../../../docs/PLUGINS.md#L185-L196) - \"HTTP routes are not, because there is no HTTP server\""
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
listener: a plain request -> /api -> the HTTP API, as today
                          -> [new] /plugins/<name>/... -> Host check -> handler(Request) -> Response
```

### Gaps

- No registration kind for a route, and the domain reference says there is none because there was no HTTP server.
- The listener hands every plain request to one handler.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin registers from a closed set of kinds, one register method each, and every registration is checked](../../../decisions/plugin-registration-kinds.md) | a route is a new row in that set |
| 2 | [cofold's serve() takes a Request and answers a Response, and Node gets an adapter](../../../decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md) | the handler shape a route shares |
| 3 | [The HTTP API checks Origin and Host, and takes only JSON bodies](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) | the guards, of which a route takes only Host |

| What | Source | Task |
| --- | --- | --- |
| `registerRoute(handler: (request: Request) => Promise<Response>)`, one per plugin, served under `/plugins/<name>/` | Softov, 2026-09-26 | 01, 02 |
| The Host check applies to a route; the Origin and JSON-only checks do not, and the route authenticates its own caller | Softov, 2026-09-26 | 02 |
| Routes are served whenever a plugin registers one, with `http` on or off | Softov, 2026-09-26 | 02 |
| What a route does on the host goes through its plugin's connection, so the plugin's grants apply | [plan 20](../20-a-plugin-is-a-client-of-its-own-host/plan.md) | - |
| Waits on daemon 05 tasks 15 and 16, so a route runs on Node, Bun and Deno | Softov, 2026-09-26 | 02 |
| The registration kinds table, the "not a kind" line and `docs/PLUGINS.md` gain the route | decision 1 | 03 |

## Proposed architecture

- **Data flow** - the request's path below `/plugins/<name>` reaches the handler unchanged; its `Response` goes back as it is.
- **Event flow** - none.
- **State flow** - none; a route holds what its plugin holds.
- **Layer responsibilities** - `packages/sdk`: the kind, its check and its fold · `packages/server` and `packages/sdk/src/listen.ts`: the prefix and the Host check · `docs/PLUGINS.md` and `00-plugin.md`: the kind.
- **Source-of-truth files** - [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - registerRoute is a registration kind](task-01-register-route-is-a-kind.md) | todo | - |
| [02 - The listener serves a plugin's route under /plugins/<name>/](task-02-the-listener-serves-routes.md) | todo | 01, daemon 05 tasks 15 and 16 |
| [03 - Docs](task-03-docs.md) | todo | 02 |

## Risks and tradeoffs

- A route is reachable wherever the listener is, with no Bearer token in front of it - the route authenticates its caller, and the docs say so first.
- A slow handler holds a request open - it is the plugin's, as a slow event handler is.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-register-route-is-a-kind.md](task-01-register-route-is-a-kind.md); task 02 waits on daemon 05 tasks 15 and 16.
- **Open questions:** none.
- **Watch out for:** the plugin's `name` can hold `@` and `/`, so the prefix must be the name as a path, and a name that cannot be one is refused at registration.

## Final verification checklist

- [ ] A fixture plugin's route answers `POST /plugins/<name>/hook` with `http` off and with it on.
- [ ] A foreign `Host` is refused; a request with no `Origin` and a non-JSON body reaches the route.
- [ ] `/api` is unchanged.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/PLUGINS.md`, `00-plugin.md`, `plans/index.md` updated.
