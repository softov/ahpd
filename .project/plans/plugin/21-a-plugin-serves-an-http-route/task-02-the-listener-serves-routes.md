---
title: The listener serves a plugin's route under /plugins/<name>/
status: implemented
depends: [task-01-register-route-is-a-kind.md]
layer: "sdk listen, server"
refs:
  - "[code://packages/sdk/src/types/listen.ts#L99-L112](../../../../packages/sdk/src/types/listen.ts#L99-L112) - the plain-request handler"
  - "[code://packages/server/src/commands/run.ts#L341-L342](../../../../packages/server/src/commands/run.ts#L341-L342) - `daemonRequest`, the chain a route joins"
  - "[code://packages/server/src/commands/run.ts#L607](../../../../packages/server/src/commands/run.ts#L607) - `loadPlugins`, after `daemonRequest` is built"
  - "[code://packages/server/src/commands/run.ts#L687](../../../../packages/server/src/commands/run.ts#L687) - `plainRequests(daemonRequest)`, which the listener always gets"
  - "[code://packages/server/src/commands/run.ts#L74-L86](../../../../packages/server/src/commands/run.ts#L74-L86) - `apiOrigins`, which the open question is about"
  - "[code://.project/plans/daemon/05-an-http-api/task-15-serve-takes-a-request.md](../../daemon/05-an-http-api/task-15-serve-takes-a-request.md) - must be done first"
  - "[code://.project/plans/daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md](../../daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md) - must be done first"
  - "[code://.project/plans/daemon/05-an-http-api/task-11-origin-and-host-are-checked.md](../../daemon/05-an-http-api/task-11-origin-and-host-are-checked.md) - the Host check to share"
---

## Objective

A plain request under `/plugins/<name>/` reaches that plugin's handler as a `Request` and is answered with its `Response`, on every runtime and whether `http` is on or off.

## Files

- `UPDATE: packages/server/src/commands/run.ts:341-342` - `daemonRequest` tries the tools servers, then a plugin route, then what is below; the route is looked up per request in the fold `loadPlugins` makes at line 607, through a variable assigned once the fold exists.
- `CREATE: packages/server/test/plugin-route.test.ts` - the cases below.

## Steps

1. The listener already gets `plainRequests(daemonRequest)` with `http` on or off (`run.ts:687`), and daemon 05 tasks 15 and 16 made it a `Request` on Node, Bun and Deno; nothing changes in `listen.ts`.
2. `/api` goes to the API as today; a path under task 01's prefix, matched by whole segments, to that plugin's handler; any other path answers as it does now.
3. The Host check before a route runs waits on the plan's open question; do not apply Origin or the JSON-only check.
4. A handler that throws answers 500 with a sentence and is reported against its plugin; the daemon keeps running.

## Validation

- `packages/server/test/plugin-route.test.ts`: a route answers with `http` off and on; `Host` is checked as the open question settles; `/plugins/%40ahpd/xy` does not reach `@ahpd/x`; a form body with no `Origin` reaches the route; a throwing handler answers 500 and the next request is served; an unknown plugin name answers 404.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

- The mount is `pluginRoutes(options)` in `packages/server/src/http.ts`, beside `apiHandler` and `withoutApi`, and it goes through the **existing** `guarded` wrapper rather than a second copy: `pathOf` and the per-segment `decodeURIComponent` are the same code the API uses, so a path that is not a valid percent-encoding is a 400 here as well.
- `guarded` is unchanged. `hostRefusal(request, authorities, subject)` is the new shared half of `foreign`: it takes the sentence the caller wants, and `foreign` passes `'This API'` so every API message is byte-for-byte what it was. A route passes `'This route'` and takes that check alone - no `Origin`, no JSON-only, which is why `foreign` itself still does the `Origin`.
- `PluginRoutesOptions` is four reads: `routes()` and `authorities()` are functions because the mount is built before the fold exists, `otherwise(request)` is what answers a path that is nobody's route (the API, or the 426), and `onProblem` is a log line. `routeOf` from the SDK decides whose route it is; a path under `/plugins/` that no loaded plugin registered is `404 No plugin route at <path>` rather than the 426, so an author whose route did not load is told there is nothing there.
- A handler that throws is caught inside `pluginRoutes`, answered `500` with a message naming the plugin and not the reason, and reported through `onProblem` as `plugin <name> failed at <path>: <reason>` - the wording `raise` already uses for an event handler that throws, which is the sentence a log reader is looking for.
- In `run.ts`, `daemonRequest` is now `(await toolsServers.request(request)) ?? pluginRequests(request)`. `pluginRequests` is a `let` initialised to `below`, because the chain is built before `loadPlugins` runs; it is assigned the mount on the line after `loadPlugins` returns, which is before the socket is bound, so `below` never answers a route on a running daemon.
- `loadPlugins` gained `routes: folded.routes` and the `LoadedPlugins.routes` field, so `run.ts` destructures `routes: registered` beside `folded` and `problems`.
- The `Host` list is `apiOrigins(apiHost, options.resource, boundPort).authorities` - the same function the API's check uses, built whether `http` is on or off, because `apiOrigins` needs nothing but names and a port - plus `announcedNames(said)`. **`boundPort` rather than `apiBoundPort`**: a route is served on the daemon's own listener, so it is reached by the names of *this* port, and `http.port` moving the API to a listener of its own must not move the route's names with it. The `http: { port: 0 }` case pins this.
- `announcedNames(lines)` is exported from `run.ts` beside `apiOrigins`, and scans each plugin `say` line for `[a-zA-Z][\w+.-]*:\/\/[^\s,;()]+`, adding `at.host` and `at.hostname` for each URL a parser reads. The trailing character class stops at a space, comma, semicolon or bracket so the `, port 443` after a tunnel's address is not part of the host. A URL a parser refuses is skipped, not fatal to the line.
- `@ahpd/tunnel-devtunnel` announcing its URL stays a follow-up, as the plan says. Today it says `tunnel <id> (<label>), port <port>`, and a label is not a URL; the fixture is what makes the rule testable until that lands.
- The fixture is `packages/server/test/fixtures/plugin-route` - scoped name `@ahpd/plugin-route` on purpose, so the whole suite exercises the encoded prefix - with a `package.json` naming `./index.ts`, because a directory spec needs an entry (a fixture without one is skipped with `has no plugin entry`). It announces `tunnel fixture-tunnel (https://fixture-tunnel.example.com/), port 443` and answers every request with the path, method, host, origin, content-type and body it saw; a path ending `/boom` throws.
- Tests, `packages/server/test/plugin-route.test.ts`: a form body with no `Origin` and the whole path reaching the handler (`http` off and on); the prefix with and without its trailing slash; a foreign `Host` refused 403; a request naming no `Host` refused 403; the announced tunnel host served and `host:443` refused, because the announced URL named no port - what was announced is what answers; three near-miss paths answering 404 without disturbing the route; an unloaded plugin's name answering `No plugin route at`; a throwing handler answering 500, naming the plugin, keeping the reason in stderr and still serving the next request; `/api` still 404 with `http` off and the 426 elsewhere; a cross-site `Origin` served by the route while the API still refuses its own guards; the route served on the daemon's port with `http.port` naming one of its own; and `announcedNames` on prose.
- `Host` and `Origin` are written over a socket, because a client library owns both headers and cannot be asked to send either.
- Not known to the plan: a route is mounted by every daemon, including one with no plugin that registered one, so `/plugins/` is answered 404 rather than 426 on a daemon nobody extended. That is a one-line change if a reader would rather see the 426.

