---
title: cofold's serve() takes a Request and answers a Response, and Node gets an adapter
status: accepted
date: 2026-09-26
refs:
  - file:///github/cofold/packages/remote/src/serve.ts - `serve()` returns a `node:http` `(IncomingMessage, ServerResponse)` handler
  - "[code://packages/sdk/src/listen.ts#L84-L92](../../packages/sdk/src/listen.ts#L84-L92) - `listen` refuses a request handler on Bun and Deno"
  - "[code://packages/server/src/commands/run.ts#L402-L404](../../packages/server/src/commands/run.ts#L402-L404) - the daemon passes a request handler on Node only"
  - https://fetch.spec.whatwg.org/ - the `Request` and `Response` that Node, Bun and Deno all have
---

## Context

ahpd runs on Node, Bun and Deno, and its HTTP API runs on Node only: `serve()` answers `node:http`'s request and response, and a daemon on Bun or Deno with `http` on refuses to start.
`Bun.serve` and `Deno.serve` hand a handler a web-standard `Request` and take a `Response` back, and Node 22 has both as globals.

## Decision

`serve()` in `@cofold/remote` returns `(request: Request) => Promise<Response>`, and `toNodeListener(handler)` wraps it for `node:http`.
The request body is read as a stream with the size limit enforced as bytes arrive, the response can be a stream, the Node adapter pipes with backpressure, and a client that hangs up reaches the handler as `request.signal`.
ahpd's `listen()` mounts the handler on `Bun.serve` and `Deno.serve` beside the WebSocket upgrade, and on Node through the adapter.
It is released as `@cofold/remote` 0.4.0 through cofold's `release.yml`.
Source: Softov, 2026-09-26, asked "With streaming kept, make serve() fetch-style with a Node adapter, as @cofold/remote 0.4.0?": "Yes, fetch-style serve".

## Consequences

The HTTP API runs on all three runtimes, with one implementation of routing, `authorize`, body reading and error mapping.
A test calls the handler with a `Request` and reads the `Response`, with no socket.
Every caller of `serve()` changes: the clerver example, `serve.test.ts`, and ahpd's `http.ts` and `listen.ts`; ahpd moves to `^0.4.0` deliberately, since 0.4.0 is outside `^0.3.1`.
The raw Node surface is out of reach from a handler: the socket, trailers and informational responses; the WebSocket upgrade stays in `listen()`.

## Options

- **A fetch-style core under a new name, with `serve()` kept as its Node adapter.** No caller changes, and the standard shape becomes the secondary name.
- **Node only.** No cofold change, and the README's "runs on Bun and Deno" gains an exception.
