---
title: The SDK mounts the Node listener the server adapts, and depends on no cofold package
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/sdk/src/listen.ts](../../packages/sdk/src/listen.ts) - `listen` and `serveRequests`, which serve a host's plain requests on each runtime"
  - "[code://packages/server/src/http.ts](../../packages/server/src/http.ts) - the API handler, the one caller with an HTTP surface"
  - "[decisions/cofold-serve-is-fetch-style-with-a-node-adapter.md](cofold-serve-is-fetch-style-with-a-node-adapter.md) - the fetch-style handler and its Node adapter"
  - npm://@cofold/remote@^0.4.0 - `toNodeListener`
---

## Context

The API handler is fetch-style, which `Bun.serve` and `Deno.serve` take as it is, and which Node's `node:http` server beside `ws` takes only through an adapter.
`@cofold/remote` has that adapter, and `@ahpd/server` already depends on it.

## Decision

`@ahpd/sdk` depends on no `@cofold/*` package.
A host with an HTTP surface hands `listen` and `serveRequests` the fetch-style handler for Bun and Deno and, for Node, the `node:http` listener it built from that handler; the SDK mounts whichever its runtime takes.
`@ahpd/server` builds the Node listener with `toNodeListener`.
Source: Softov, 2026-09-28, asked "How should the SDK get the HTTP handler without depending on cofold?": "Server adapts, SDK mounts".

## Consequences

The SDK stays free of the API's dependencies, and a host that serves no HTTP carries nothing extra.
A host that serves HTTP on Node without a Node listener is refused at `listen`, since the SDK cannot translate one itself.

## Options

- **The SDK translates on its own.** No dependency, and a second copy of the body streaming, backpressure and abort handling cofold already has.
- **The API only on its own port.** `listen` carries no HTTP handler, and the shared-port mode goes away.
- **`@cofold/remote` as an optional dependency of the SDK.** One import in `listen`, and the SDK takes on a package that only the server's API needs.
