---
title: Each agent README explains every option
status: todo
depends: []
layer: "docs"
refs:
  - "[code://packages/agent-claude/README.md](../../../../packages/agent-claude/README.md) - the shape the others take, with `Options` lifted out of `In the daemon`"
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts) - its `optionsSchema`"
  - "[code://packages/agent-acp/src/plugin.ts](../../../../packages/agent-acp/src/plugin.ts) - its `optionsSchema`"
  - "[code://packages/agent-cofold/src/plugin.ts](../../../../packages/agent-cofold/src/plugin.ts) - its `optionsSchema`"
  - "[code://packages/agent-pi/src/plugin.ts](../../../../packages/agent-pi/src/plugin.ts) - its `optionsSchema`"
---

## Objective

The READMEs of `agent-claude`, `agent-acp`, `agent-cofold` and `agent-pi` follow the plan's section order, and each one explains every option its `optionsSchema` holds.

## Files

- `UPDATE: packages/agent-claude/README.md` - move the option table to `Options`, add `Commands`, check each row against the schema.
- `UPDATE: packages/agent-acp/README.md` - add `Commands`, check each row against the schema, `toolsChanged` first.
- `UPDATE: packages/agent-cofold/README.md` - add `Commands`, check each row against the schema.
- `UPDATE: packages/agent-pi/README.md` - add `Commands`, check each row against the schema.
- `CREATE: packages/agent-cofold/LICENSE` - a copy of the root `LICENSE`.

## Steps

1. Read the `optionsSchema` of the package, nested properties included.
2. Put the README's sections in the order the plan's decisions give.
3. Write a complete `config.json` block in `In the daemon`.
4. Give each schema property one row with its default and one sentence on what it does.
5. Remove each row that names a property the schema does not have.
6. Add `Commands` with `plugin install`, `plugin update`, `plugin list`, and `vault` where an option takes `$secret`.
7. Move each explanation longer than one sentence to the `docs/` file that covers it, and link it.
8. Copy the root `LICENSE` to `packages/agent-cofold/LICENSE`.

## Validation

- For each package, the schema's property names and the `Options` rows are the same set.
- Every link in the four READMEs resolves.
- `pnpm build` passes.

## Resume
