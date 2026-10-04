---
title: A plugin serves an HTTP route on the daemon's listener - implemented
date: 2026-10-04
refs:
  - git://22e5c2e
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts)"
  - "[code://packages/server/src/http.ts](../../../../packages/server/src/http.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
---

A plugin registers one route with `registerRoute(handler)`, and the daemon serves it under `/plugins/<name>/` on its own listener, with `http` on or off, so a tunnel carries it and no second port opens.

## What was built

- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `Route`, `PluginHost.registerRoute` and `Contribution.routes`.
- [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts) - `routePrefix`, which percent-encodes each segment of the name, and `routeOf`, which matches whole segments; the fold's `routes`, keyed by plugin name.
- [`code://packages/sdk/src/validate.ts`](../../../../packages/sdk/src/validate.ts) - `checkRoute`, and a second `registerRoute` refused.
- [`code://packages/server/src/http.ts`](../../../../packages/server/src/http.ts) - `pluginRoutes`, mounted through `guarded`, with the Host check alone, shared with the API as `hostRefusal`.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - `announcedNames`, which adds the host of each `scheme://` URL a plugin says to the names a route answers to.
- `docs/PLUGINS.md` and `00-plugin.md` gain the route kind.

## Verified

- `packages/server/test/plugin-route.test.ts` (14 cases) runs real daemons with `http` off, `http: true` and `http: { port: 0 }`, against a fixture plugin with a scoped name that announces a URL; `plugin-fold` and `plugin-validate` cover the SDK half.
- The announced names reach only the route mount, never the API's own Host check.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (180 files, 2786 tests, with host 46) pass on `main` at `22e5c2e`.

## Departures from the plan

- The route's Host names use the daemon's own port, not the API's, so `http.port` moving the API does not move a route.
- `Host: <announced-host>:443` is refused when the announcement named no port.
- A path under `/plugins/` that no plugin registered answers 404 on every daemon, rather than the listener's 426.

## Left for later

- `@ahpd/tunnel-devtunnel` announcing its URL, so a route is reachable through that tunnel.
- A route acting on the host through its plugin's own connection, which plan 20 brings.
- The tasks stay `implemented` until Softov reviews them.
