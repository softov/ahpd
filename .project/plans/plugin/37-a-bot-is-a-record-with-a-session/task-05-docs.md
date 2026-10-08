---
title: Docs
status: todo
depends: [task-04-making-a-bot-starts-its-session.md]
layer: "docs"
refs:
  - "[code://docs/USERS.md#L385-L404](../../../../docs/USERS.md#L385-L404) - the grants table's scheme rows"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the `PluginHost` methods"
---

## Objective

A person can read how to make, edit and delete a bot, and which grants each needs.

## Files

- `CREATE: docs/BOTS.md` - the record, the slug, the folder and the `root` option, bodies and colours, the session, and an example write.
- `UPDATE: docs/USERS.md:385-404` - a `bot` row.
- `UPDATE: docs/PLUGINS.md` - `startSession`.
- `UPDATE: packages/bot/README.md` - what the plugin serves.

## Steps

1. Write each page from the code as built.

## Validation

- Every example write in `docs/BOTS.md` is the body a test sends.
- `node tools/schema.mjs` passes.

## Resume

