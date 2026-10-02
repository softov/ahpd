---
title: Usage - what exists today
domain: usage
revalidated: 2026-10-01
---

Usage is what the host records about model use and computer time, so it can be reported and, later, limited per user, team and project.
Today the host keeps none of it: backends send `chat/usage` and the host relays it and forgets it.

## Packages

- [`code://packages/sdk`](../../../packages/sdk) - the host and its ports; a `usage` port will live here.
- [`code://packages/server`](../../../packages/server) - the composition root that wires the default store.

## Contracts

- [`code://packages/sdk/src/types/host.ts`](../../../packages/sdk/src/types/host.ts) - `HostOptions`, where a port is injected.
- [`code://packages/sdk/src/types/plugin.ts`](../../../packages/sdk/src/types/plugin.ts) - `PortKey`, the closed union of ports.

## Runtime path

```
backend chat/usage -> session emit -> dispatch -> clients (and nothing else)
```

## Tests

- [`code://packages/sdk/test/sessions.test.ts`](../../../packages/sdk/test/sessions.test.ts) - the versioned file store pattern a usage store copies.

## Known gaps

- No record, no store, no totals, no cost.
- No owner on the work (host 34).
- The policy rules are a draft: file:///github/ahp-review/prospect/ahp-user-rules.md.
