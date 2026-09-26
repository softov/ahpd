---
title: An HTTP API is served by @cofold/remote, and ahpd mounts it
status: accepted
date: 2026-09-26
refs:
  - file:///github/cofold/examples/commands/clerver/server.ts - the example's own 90-line server, what `serve()` is promoted from
  - file:///github/cofold/ROADMAP.md - whether a `serve` entry point should render the registry as an HTTP API, an open item there
---

## Context

`@cofold/remote` describes a registry as a manifest and OpenAPI and calls one over HTTP, and does not serve one.
The `clerver` example serves its registry with a hand-written server: routes from `meta.http`, `canonicalFromObject`, `registry.execute(..., { surface: 'remote' })`, and `/cli-manifest`.

## Decision

That server is promoted into `@cofold/remote` as `serve(registry, program, options)`, a request handler with an `authorize` context, and the example uses it.
ahpd mounts it under `/api`.
Source: Softov, 2026-09-26, asked "knowing the example hand-rolls its ~90-line server, where should the server live?", answered "Promote it to serve() in @cofold/remote".

## Consequences

Every cofold program gets an HTTP API from its registry, and cofold's roadmap item is answered.
A cofold release comes before ahpd's API.

## Options

- **Copy the pattern into ahpd.** No cofold release, and two copies of one handler that drift.
