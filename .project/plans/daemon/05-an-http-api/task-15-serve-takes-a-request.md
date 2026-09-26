---
title: "`serve()` takes a Request and answers a Response, with a Node adapter (cofold repository)"
status: todo
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
