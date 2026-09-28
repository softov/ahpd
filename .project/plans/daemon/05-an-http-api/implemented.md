---
title: An HTTP API for the daemon, from the same commands, under the same grants - implemented
date: 2026-09-28
refs:
  - git://a18432e
  - npm://@cofold/remote@^0.4.0 - `serve()`, a `Request` handler, and `toNodeListener`
  - "[code://packages/server/src/http.ts](../../../../packages/server/src/http.ts) - `apiHandler`, `withoutApi`, the guards, `plainRequests` and `listenApi`"
  - "[code://packages/server/src/commands/authorize.ts](../../../../packages/server/src/commands/authorize.ts) - a Bearer token to a principal, the path a WebSocket takes"
  - "[code://packages/server/src/commands/scopes.ts](../../../../packages/server/src/commands/scopes.ts) - the grant pair each served command needs"
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) - `listen` and `serveRequests` on Node, Bun and Deno"
---

With `http` on, the daemon serves its own commands (status, plugins, users, config) under `/api`, on its own port or on `http.port`, on Node, Bun and Deno.
A request signs in with `Authorization: Bearer` the way a WebSocket connection does and is allowed by the same grants, and `ahpd --remote <url>` runs the same commands against it.

## What was built

- [`code://packages/server/src/http.ts`](../../../../packages/server/src/http.ts) - `apiHandler` serves the registry through `@cofold/remote`'s `serve()` as a `Request` handler; `withoutApi` answers 404 under `/api` when `http` is off; `Host` and `Origin` are checked and only JSON bodies are taken; `plainRequests` builds the Node listener with `toNodeListener`; `listenApi` binds `http.port` and `http.host`.
- [`code://packages/server/src/commands/authorize.ts`](../../../../packages/server/src/commands/authorize.ts) and [`code://packages/server/src/commands/scopes.ts`](../../../../packages/server/src/commands/scopes.ts) - the token read as the connection token, a user's token or an issuer's, and each command's grant checked in the registry's `authorize` hook; `plugin install` and `plugin remove` need the deployment token.
- [`code://packages/server/src/commands/registry.ts`](../../../../packages/server/src/commands/registry.ts) - the remote surface drops `configFile`, `users`, `plugins` and `paths`, so a served command acts on the daemon's own options; served answers hide the connection token, plugin option values and the credentials in a plugin URL; a user command gives only what its caller holds.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) and [`code://packages/server/src/main.ts`](../../../../packages/server/src/main.ts) - `--remote`, `--token`, `--token-file` and `AHPD_TOKEN`, a per-user 0700 manifest cache, the cleartext warning, and a daemon with no token and no users refusing to start with `http` on.
- [`code://packages/sdk/src/listen.ts`](../../../../packages/sdk/src/listen.ts) - `ListenOptions.request` is a fetch-style handler; on Node `listen` and `serveRequests` mount the `nodeRequest` they are handed, and `@ahpd/sdk` depends on no `@cofold/*` package.
- `node-pty` is `@ahpd/server`'s optional dependency, where `pty.ts` imports it.
- [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) and [`code://docs/USERS.md`](../../../../docs/USERS.md) - the API, its grants and guards, `--remote`, and the three runtimes.

## Verified

- [`code://packages/server/test/server-http.test.ts`](../../../../packages/server/test/server-http.test.ts) - every item in the plan's checklist, including the handlers called with a `Request` and no socket.
- [`code://packages/sdk/test/listen.test.ts`](../../../../packages/sdk/test/listen.test.ts) - a Node handler with no `nodeRequest` is refused, and plain requests are served beside the WebSocket.
- By hand from the built daemon on `node`, `bun` and `deno run -A`, with `http` on the daemon's port, on `http.port`, and off: status with and without the token, `ahpd --remote ... user list`, malformed `Host` and escapes answered 400, a foreign `Host` 403, the WebSocket still open; a pseudoterminal still opened from the server's `node-pty`.
- Softov reviewed every task, the last two on 2026-09-28.
- `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` green at the close.

## Departures from the plan

- `@cofold/remote`'s `serve()` became fetch-style with a Node adapter (tasks 15, 16), so the API runs on Bun and Deno too, where the plan named Node only.
- The SDK does not import `@cofold/remote` at all: the server adapts the handler for Node and hands it to `listen` as `nodeRequest` (task 35).

## Left for later

- Nothing from the plan. A command added to the API later must take no path from the request, must not reach `stop`, and must declare a grant pair.
