---
title: serve() hands the principal its authorize resolved to the registry as the actor
status: accepted
date: 2026-09-26
refs:
  - file:///github/cofold/packages/remote/src/serve.ts - `serve()` calls `authorize` with the request, then `registry.execute` with the headers and no `actor`
  - "[code://packages/server/src/commands/registry.ts](../../packages/server/src/commands/registry.ts) - the registry whose `authorize` hook checks a command's scopes"
---

## Context

The registry's `authorize` hook checks a command's scopes on every surface, and on the HTTP surface it needs the principal the request signed in as.
`serve()` in `@cofold/remote` resolves that principal through its own `authorize` and then calls `registry.execute` with the request headers only, so the hook cannot see who is asking.

## Decision

`serve()` passes what its `authorize` returned to `registry.execute` as `request.actor`, and ahpd's hook reads the principal from there.
Source: Softov, 2026-09-26, asked "daemon/04 task 14 moves scope checks into the registry's authorize hook, but cofold's serve() hands registry.execute only the request headers, not the principal it resolved. How does the principal reach the hook?": "serve() passes actor".

## Consequences

A request is verified once.
It is a change to `@cofold/remote`, so it goes in the same release as the `serve()` crash fixes of daemon/05 task 06 (0.3.1, cut by Softov from a tagged commit).
`serve()` stays agnostic: it carries whatever `authorize` answers and knows nothing of ahpd's principals.

## Options

- **The hook resolves the principal again from the headers.** No cofold change, and every request is verified twice, including a round trip to the issuer for an issuer token.
