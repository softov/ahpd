---
title: The HTTP API is served on Node, Bun and Deno
status: todo
depends: [task-15-serve-takes-a-request.md, task-07-the-listener-survives-a-malformed-request.md]
layer: "sdk | server"
refs:
  - "[decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md](../../../decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md) - what this task applies"
  - "[code://packages/sdk/src/types/listen.ts#L95-L108](../../../../packages/sdk/src/types/listen.ts#L95-L108) - `ListenOptions.request`, typed as a `node:http` handler"
  - "[code://packages/sdk/src/listen.ts#L84-L92](../../../../packages/sdk/src/listen.ts#L84-L92) - the refusal on Bun and Deno"
  - "[code://packages/sdk/src/listen.ts#L145-L156](../../../../packages/sdk/src/listen.ts#L145-L156) - Bun's `fetch`, which upgrades or answers 426"
  - "[code://packages/sdk/src/listen.ts#L196-L204](../../../../packages/sdk/src/listen.ts#L196-L204) - Deno's handler, the same"
  - "[code://packages/sdk/src/listen.ts#L284-L293](../../../../packages/sdk/src/listen.ts#L284-L293) - Node's plain server beside `ws`"
  - "[code://packages/server/src/http.ts#L81-L192](../../../../packages/server/src/http.ts#L81-L192) - `apiHandler`, `withoutApi`, `listenApi` and `pathOf`"
  - "[code://packages/server/src/commands/run.ts#L178-L180](../../../../packages/server/src/commands/run.ts#L178-L180) - the refusal to start with `http` off Node"
  - "[code://packages/server/src/commands/run.ts#L470-L472](../../../../packages/server/src/commands/run.ts#L470-L472) - the handler passed on Node only"
  - "[code://docs/DAEMON.md#L389-L391](../../../../docs/DAEMON.md#L389-L391) - the docs that say the API is Node-only"
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
- `UPDATE: packages/server/src/commands/run.ts:178-180, 470-472` - no refusal, and the handler is passed on every runtime.
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
