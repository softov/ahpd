---
title: Proxy - what exists today
domain: proxy
revalidated: 2026-10-01
---

The proxy forwards model calls from people's own tools (Claude Code, scripts) to a model provider, under their ahpd identity, so the calls can be routed, recorded and limited.
It is not an agent: it holds no session and runs nothing.
Nothing of it exists yet.

## Packages

- [`code://packages/server`](../../../packages/server) - config, commands and listeners; the proxy lives here.

## Contracts

- [`code://packages/server/src/config.ts`](../../../packages/server/src/config.ts) - `Config`, where the proxy's settings go.
- [`code://packages/server/src/commands/registry.ts`](../../../packages/server/src/commands/registry.ts) - commands declared once, CLI and `/api`.

## Runtime path

```
(later) client -> proxy listener -> users.verify -> model name -> provider -> upstream, streamed back
```

## Tests

- [`code://packages/server/test/config-check.test.ts`](../../../packages/server/test/config-check.test.ts) - config checking.

## Known gaps

- No provider, no model name table, no listener, no streaming path.
- The only endpoint record in the tree is cofold's private `HarnessProvider` ([`code://packages/agent-cofold/src/config.ts#L21-L30`](../../../packages/agent-cofold/src/config.ts#L21-L30)).
