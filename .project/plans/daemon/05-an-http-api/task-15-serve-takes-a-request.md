---
title: "`serve()` takes a Request and answers a Response, with a Node adapter (cofold repository)"
status: implemented
depends: [task-06-serve-survives-a-malformed-request.md]
layer: "cofold remote"
refs:
  - "[decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md](../../../decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md) - what this task applies"
  - file:///github/cofold/packages/remote/src/serve.ts - `RequestHandler` at line 44, `serve()` at line 78, `readBody` at line 200
  - file:///github/cofold/packages/remote/src/serve.test.ts - the cases, several over a real server or `node:net`
  - file:///github/cofold/packages/remote/src/index.ts - the exports
  - file:///github/cofold/examples/commands/clerver/server.ts - `createServer(serve(registry, program))`
  - file:///github/cofold/.github/workflows/release.yml - how the release is staged
---

## Objective

In `/github/cofold`, `serve()` returns `(request: Request) => Promise<Response>` and `toNodeListener(handler)` serves it on `node:http`, with every behaviour of 0.3.1 kept: the routes, the manifest, `authorize` and `request.actor`, the 400 for a bad URL, `Host` or escape, the 413 and 415 for a body, and the "Failed" for an unexpected error.
It is released as `@cofold/remote` 0.4.0.

## Files

- `UPDATE: /github/cofold/packages/remote/src/serve.ts` - the handler takes a `Request`; the body is read from `request.body` as a stream, cancelled once it passes `maxBodyBytes`; answers are `Response` objects; `ServeRequest.headers` becomes a `Headers`.
- `CREATE: /github/cofold/packages/remote/src/node.ts` - `toNodeListener(handler)`: builds a `Request` from the `IncomingMessage` (body through `Readable.toWeb`, an `AbortSignal` aborted when the client closes), and writes the `Response` back through `Readable.fromWeb` and `pipeline`; a `Host` or URL the `Request` constructor refuses is answered 400 here.
- `UPDATE: /github/cofold/packages/remote/src/index.ts` - exports `serve`, `toNodeListener` and the types.
- `UPDATE: /github/cofold/packages/remote/src/serve.test.ts` - the cases below.
- `UPDATE: /github/cofold/examples/commands/clerver/server.ts` - `createServer(toNodeListener(serve(registry, program)))`.
- `UPDATE: /github/cofold/packages/remote/README.md` and `ROADMAP.md` - `serve` as it now is.
- `UPDATE: /github/cofold/packages/remote/package.json` - version `0.4.0`.
- `UPDATE: /github/cofold/.github/workflows/ci.yml` - the `runtimes` job serves the built clerver on Node, Bun and Deno and reads it back.

## Steps

1. Apply decision [cofold-serve-is-fetch-style-with-a-node-adapter](../../../decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md).
2. `serve()` uses only web-standard globals (`Request`, `Response`, `Headers`, `URL`, `ReadableStream`), so the module imports nothing from `node:`; `node.ts` is the only file that does.
3. Pass `request.signal` to `registry.execute` as the command's signal.
4. Keep `readBody`'s rules: an empty body is `{}`, a non-empty body must be `application/json`, a body past the limit is 413 and stops being read.
5. `npm run check` in `/github/cofold`.
6. Commit on cofold's `main`, one commit, and stage the release with a `release-*` tag through `release.yml`; Softov approves it on npm.

## Validation

- `serve.test.ts`, each case calling the handler with a `Request` and no socket: a route answers its data; the manifest answers; a `text/plain` body answers 415; a body past `maxBodyBytes` answers 413; a command that throws `new Error('/secret/path')` answers 500 "Failed"; `authorize`'s answer reaches the command as `request.actor`; an aborted `request.signal` reaches the command's `context.signal`.
- `serve.test.ts`, through `toNodeListener` on a real server: a raw request over `node:net` with `Host: a b` answers 400 and the next request is answered; a streamed response arrives in chunks.
- The clerver example runs on Node, Bun and Deno in cofold's CI `runtimes` job.
- `npm run check` in `/github/cofold` green.

## Resume

Built in `/github/cofold`, uncommitted, 2026-09-27.
`serve()` now returns `(request: Request) => Promise<Response>` and imports nothing from `node:`, and `toNodeListener(handler)` in the new `packages/remote/src/node.ts` serves it on `node:http`.
The request body is read from `request.body` as a stream and cancelled with 413 once it passes `maxBodyBytes`, an empty body is still `{}`, and any other non-JSON body is still 415.
`ServeRequest.headers` is a `Headers`, `authorize`'s answer still reaches the command as `request.actor`, and `request.signal` is passed to `registry.execute` as the command's signal.
The adapter answers 400 for a URL or `Host` the `Request` constructor refuses, aborts `request.signal` when the client hangs up, and streams the response through `Readable.fromWeb` and `pipeline`.
The exported type `RequestHandler` keeps its name and now has the fetch shape.
Every 0.3.1 case in `serve.test.ts` now runs through `toNodeListener`, with seven new cases that call the handler with a `Request` and three more through the adapter, covering a streamed response, 413 over a socket and a client hang-up.
Run against the 0.3.1 handler first, the direct-call cases failed with "Cannot read properties of undefined (reading 'status')".
The clerver example uses `createServer(toNodeListener(serve(registry, program)))`, and the package README and `ROADMAP.md` describe `serve` as it now is.
cofold's CI `runtimes` job has a new step, "One server, three runtimes", that serves the built clerver on a free port under node, bun and `deno run -A`, runs `pet list` against it, and fails unless the answer names Ada; its body passed locally on all three runtimes.
`packages/remote/package.json` is at version 0.4.0.
`pnpm check` in `/github/cofold` passed with 71 files and 842 tests and no type errors.
The commit and the `release-*` tag are Softov's, and task 16 starts once `@cofold/remote` 0.4.0 is on npm.
