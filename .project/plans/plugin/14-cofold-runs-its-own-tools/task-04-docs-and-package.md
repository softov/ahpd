---
title: Docs and the package
status: implemented
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

Done.
`docs/PLUGINS.md` has a row for the `tools` option on the cofold options table and a "The tools a session runs" section: the four capabilities and that cofold runs them in its own process, a `web.search` example that turns `shell` off, the provider rules and that `web_search` is absent without one, and where memory lives.
`packages/agent-cofold/package.json` declares `@cofold/tools@^0.0.1` and `pnpm-lock.yaml` carries it, added with `pnpm install --no-frozen-lockfile --store-dir /tmp/pnpm-store` because the global store is read-only here.
`pnpm install --frozen-lockfile` is clean afterwards and `pnpm boundary` is green.
