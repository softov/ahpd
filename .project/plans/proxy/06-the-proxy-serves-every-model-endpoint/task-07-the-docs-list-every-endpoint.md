---
title: The docs list every endpoint
status: done
depends: [task-01-tokens-are-counted.md, task-02-embeddings-are-served.md, task-03-responses-are-served.md, task-04-images-are-served.md, task-05-audio-is-served.md, task-06-rerank-is-served.md]
layer: "docs"
refs:
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the proxy's guide"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - `provider(connector)` and `accepts`"
---

## Objective

The proxy guide lists each endpoint, its paths, which host adapters serve it, and how it is charged.

## Files

- `UPDATE: docs/server/PROXY.md` - a table of endpoints, the Responses ids, the multipart bodies and the new prices.
- `UPDATE: docs/plugins/PLUGINS.md` - every dialect a provider adapter may accept, and `ModelProvider.paths`.
- `UPDATE: .project/plans/proxy/00-proxy.md` - the dialects in the contracts.

## Steps

1. Add a table with one row per endpoint: its paths, its dialect and the host adapters that accept it.
2. Say that a Responses id holds its connector, and that a follow-up goes there.
3. Say that a count call writes no record.
4. Add `characters` and `minutes` to the price section, with their units.
5. List every dialect and `ModelProvider.paths` in the adapter section of PLUGINS.md.
6. Add the dialects to `00-proxy.md`.

## Validation

- `lint-prose` passes on `00-proxy.md`.
- Every path in the table is one the listener answers.

## Resume
