---
title: Docs
status: implemented
depends: [task-04-making-a-bot-starts-its-session.md]
layer: "docs"
refs:
  - "[code://docs/RESOURCES.md#L43-L48](../../../../docs/RESOURCES.md#L43-L48) - where the schemes this host serves are named, which is where the `bot:` row went"
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

- **Built:** `docs/BOTS.md` (new) - the record field by field, the slug as address, `id` and folder at once, the folder and the `root` option, the two lists of bodies and colours, the session (a link or one started at make, and what a refusal leaves behind), the grants table, four example writes and the options.
- **Departure - the grants row:** the task named `docs/USERS.md:385-404` for "a bot row". Those lines no longer hold a grants table - USERS.md was reorganised by documentation/03 and now points at RESOURCES.md for the scheme rows - so the `bot:` scheme was added where the others are named, in RESOURCES.md's **Schemes** paragraph. The grants themselves are the same ten operations every scheme has, which RESOURCES.md's **Grants** section already states; the bot-specific rule is in `docs/BOTS.md`'s own table.
- **Also updated:** `docs/README.md` (the index row, after AUTOMATIONS.md), `docs/PLUGINS.md` (a `Starting a session as an owner` section covering `startSession`, `sessionKept` and `sessionOwner` - none of the three was documented, and `sessionOwner` is new in task 02), and `packages/bot/README.md` (the `session` field, the session section, `session:create`, and the `*:*`/root row its grants table was missing). A member of the owning team or project may edit and delete, which the README said was a read - corrected to match the code and the user's rule.
- **Validation:** `docs/BOTS.md`'s four example bodies are sent by `answers the writes docs/BOTS.md shows` in `packages/bot/test/bot-provider.test.ts`, which asserts the host answers each and gives the record back. `node tools/schema.mjs` passes.

