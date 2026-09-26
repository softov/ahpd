---
title: Docs and the package
status: todo
depends: [task-02-calls-drawn-and-edits-reported.md, task-03-permission-modes-cover-them.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - where the cofold plugin's options are documented"
---

## Objective

A person reading the cofold section of `docs/PLUGINS.md` knows which tools a session has, how to turn one off, and how to give `web_search` a provider.

## Files

- `UPDATE: docs/PLUGINS.md` - the cofold plugin's `tools` option and an example.
- `UPDATE: pnpm-lock.yaml` - the new dependency's importer.

## Steps

1. Document `tools`, with a `web.search` example.
2. `pnpm install --no-frozen-lockfile` once, and commit the lockfile with the manifest.

## Validation

- `pnpm install --frozen-lockfile` clean; `pnpm boundary` green.

## Resume
