---
title: The bot, computer and tunnel READMEs explain every option
status: implemented
depends: []
layer: "docs"
refs:
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - its `optionsSchema`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - its `optionsSchema`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts](../../../../packages/tunnel-devtunnel/src/plugin.ts) - its `optionsSchema`"
  - "[code://packages/bot/README.md](../../../../packages/bot/README.md) - has `Install` where the others have `In the daemon`"
---

## Objective

The READMEs of `bot`, `computer` and `tunnel-devtunnel` follow the plan's section order, and each one explains every option its `optionsSchema` holds.

## Files

- `UPDATE: packages/bot/README.md` - rename `Install` to `In the daemon`, add `Commands` and `In your own host`, check each row against the schema.
- `CREATE: packages/bot/LICENSE` - a copy of the root `LICENSE`.
- `UPDATE: packages/computer/README.md` - rename `Install` to `In the daemon`, add `Commands` and `In your own host`, check each row against the schema.
- `UPDATE: packages/tunnel-devtunnel/README.md` - rename `Install` to `In the daemon`, add `Commands` and `In your own host`, check each row against the schema.

## Steps

1. Read the `optionsSchema` of the package, nested properties included.
2. Put the README's sections in the order the plan's decisions give.
3. Write a complete `config.json` block in `In the daemon`.
4. Give each schema property one row with its default and one sentence on what it does.
5. Remove each row that names a property the schema does not have.
6. Add `Commands` with `plugin install`, `plugin update`, `plugin list`, and `vault` where an option takes `$secret`.
7. Write `In your own host` with the `apply` call the package exports.
8. Copy the root `LICENSE` to `packages/bot/LICENSE`.

## Validation

- For each package, the schema's property names and the `Options` rows are the same set.
- Every link in the three READMEs resolves.
- `pnpm build` passes.

## Resume
