---
title: The HTTP API is served on Node, Bun and Deno
status: done
depends: [task-15-serve-takes-a-request.md, task-07-the-listener-survives-a-malformed-request.md]
layer: "sdk | server"
refs:
  - "[decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md](../../../decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md) - what this task applies"
  - "[code://packages/sdk/src/types/listen.ts#L95-L107](../../../../packages/sdk/src/types/listen.ts#L95-L107) - `ListenOptions.request`, a `Request` handler, and `nodeRequest` beside it"
  - "[code://packages/sdk/src/listen.ts#L142](../../../../packages/sdk/src/listen.ts#L142) - Bun's `fetch`, which hands a plain request to `request` before the upgrade path"
  - "[code://packages/sdk/src/listen.ts#L194](../../../../packages/sdk/src/listen.ts#L194) - Deno's handler, the same"
  - "[code://packages/sdk/src/listen.ts#L283-L292](../../../../packages/sdk/src/listen.ts#L283-L292) - Node's plain server beside `ws`"
  - "[code://packages/sdk/src/listen.ts#L333-L373](../../../../packages/sdk/src/listen.ts#L333-L373) - `serveRequests`, a handler on a port of its own on each runtime"
  - "[code://packages/server/src/http.ts#L87-L191](../../../../packages/server/src/http.ts#L87-L191) - `apiHandler`, `withoutApi`, `guarded`, `plainRequests`, `listenApi` and `pathOf`"
  - "[code://packages/server/src/commands/run.ts#L468](../../../../packages/server/src/commands/run.ts#L468) - the handler passed on every runtime"
  - "[code://docs/DAEMON.md#L389-L390](../../../../docs/DAEMON.md#L389-L390) - the docs that say the API is served on all three"
---

## Objective

A daemon with `http` on starts and serves `/api` on Node, Bun and Deno, on its own port or on `http.port`, and a plain request with `http` off is answered the same way on all three.

## Files

- `UPDATE: packages/server/package.json` and `pnpm-lock.yaml` - `@cofold/remote` `^0.4.0`, excluded from the minimum release age in `pnpm-workspace.yaml` if it is younger.
- `UPDATE: packages/sdk/src/types/listen.ts:95-108` - `request?: (request: Request) => Promise<Response>`, with no `node:http` import.
- `UPDATE: packages/sdk/src/listen.ts:84-92` - the refusal goes.
- `UPDATE: packages/sdk/src/listen.ts:145-156, 196-204` - on Bun and Deno a request that is not an upgrade goes to `options.request` when there is one, before the 401 and 426 the upgrade path answers.
- `UPDATE: packages/sdk/src/listen.ts:284-293` - on Node the plain server carries the handler through `toNodeListener`.
- `UPDATE: packages/server/src/http.ts` - `apiHandler` and `withoutApi` are `Request` handlers; `pathOf` reads `new URL(request.url).pathname`; `listenApi` serves the handler on its own port through `listen`'s runtime paths, not `node:http` directly.
- `UPDATE: packages/server/src/commands/run.ts:182-184, 474-476` - no refusal, and the handler is passed on every runtime.
- `UPDATE: docs/DAEMON.md:389-391` - the API is served on all three.
- `UPDATE: packages/server/test/server-http.test.ts` - the cases call the handlers with a `Request` where no socket is needed.

## Steps

1. Take `@cofold/remote` 0.4.0 once task 15's release is approved on npm.
2. Make `ListenOptions.request` the fetch shape and route plain requests to it on all three runtimes, keeping the upgrade and its sign-in first.
3. Rebase task 07's guard onto the `Request` shape: on Bun and Deno the runtime builds the `Request`, so a bad `Host` never reaches the handler; on Node the adapter answers it 400.
4. `http.port`'s own listener goes through the same runtime paths, so it is served on Bun and Deno too.
5. Run the daemon with `http: true` on each runtime from the built output, as `docs/DAEMON.md` says Deno is run.

## Validation

- `packages/server/test/server-http.test.ts`: `apiHandler` called with a `Request` for `GET /api/user/list` and the deployment token answers the list; `withoutApi` answers 404 for `/api/x` and 426 for `/`.
- By hand, from `packages/server/dist/main.js` with `http: true` and a connection token, on `node`, `bun` and `deno run -A`: the daemon starts, `curl -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/api/status` answers, and `ahpd --remote http://127.0.0.1:<port> --token <token> user list` answers; today Bun and Deno refuse to start with "The HTTP API is served on Node".
- The same with `http: { "port": <other> }`.
- `pnpm typecheck` and `node scripts/boundary.mjs` green.

## Resume

Built 2026-09-28 on `@cofold/remote` 0.4.0, which `packages/server/package.json` names as `^0.4.0` and `pnpm-workspace.yaml` excludes from the minimum release age in place of 0.3.1.
`ListenOptions.request` is `(request: Request) => Promise<Response>`, exported from the SDK as `RequestHandler`, and `listen` no longer refuses it on Bun or Deno.
On Bun and Deno a request that is not a WebSocket upgrade goes to `options.request` when there is one, before the 401 and 426 the upgrade path answers; on Node the plain `node:http` server carries the handler through `toNodeListener`.
`@ahpd/sdk` names `@cofold/remote` as an optional dependency and imports it only on Node for a listener that serves plain requests, the way it imports `ws`.
`serveRequests` in `packages/sdk/src/listen.ts` serves a `Request` handler on a port of its own on all three runtimes, and `listenApi` uses it for `http.port`.
`apiHandler` and `withoutApi` are `Request` handlers, `foreign` reads `Host` and `Origin` from `Headers`, `pathOf` reads `new URL(request.url).pathname`, and `authorizeOverHttp` reads the bearer with `headers.get`.
`run.ts` no longer refuses `http` off Node and passes the handler on every runtime, and `docs/DAEMON.md` says the API is served on all three and how.
Two cases in `server-http.test.ts` call the handlers with a `Request` and no socket: `apiHandler` answers `GET /api/user/list` for the deployment token and 401 without it, and `withoutApi` answers 404 for `/api/x` and 426 for `/`; both failed first with "Cannot read properties of undefined (reading 'headersSent')".
By hand from `packages/server/dist/main.js` with `http: true`, a connection token and a users file, on `node`, `bun` and `deno run -A`: the daemon started, `curl` with the token on `/api/status` answered 200 and 401 without it, `ahpd --remote <url> --token <token> user list` listed the person, `Host: a b` and `%E0%A4%A` answered 400, a foreign `Host` 403, and the WebSocket still opened.
The same with `http: { "port": <other> }` on all three: the API answered on its own port, and the daemon's port answered 404 for `/api/status` and 426 for `/`.
With `http` off, all three answered 404 for `/api/status`, 426 for `/` and 400 for `Host: a b`, and kept answering.
Deno prints its own `Listening on` line for each listener, the API's own one included.
`pnpm typecheck` and `pnpm boundary` green; `pnpm test` green, 106 files and 1494 tests.
Task 35 has since taken `@cofold/remote` out of the SDK: the server builds the Node listener and passes it as `nodeRequest`.
