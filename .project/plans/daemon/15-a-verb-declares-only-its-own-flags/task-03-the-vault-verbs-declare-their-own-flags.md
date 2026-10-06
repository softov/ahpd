---
title: The vault verbs declare their own flags
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/vault.ts#L140-L201](../../../../packages/server/src/commands/vault.ts#L140-L201) - `vault set`, `delete` and `list`, spreading `flagFields` on a line"
  - "[code://packages/server/src/commands/options.ts#L429](../../../../packages/server/src/commands/options.ts#L429) - `flagFields`, every daemon flag"
---

## Objective

On a line, the vault verbs take the fields that say where the vault is and how it is unlocked, and none of the other daemon flags.

## Files

- `UPDATE: packages/server/src/commands/vault.ts:140-201` - a vault location set in place of `flagFields`.
- `UPDATE: packages/server/src/commands/options.ts` - that set, if it is shared.

## Steps

1. Read what the vault verbs and the vault opener read from the context, and declare exactly those.

## Validation

- Written first and seen failing: `vault delete` refuses `--port`, naming it; `vault list` with the config flag it needs still works.
- The existing vault command tests stay green.
