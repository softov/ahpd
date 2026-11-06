---
title: ahpd config set writes a key
status: done
depends: [task-01-the-modelapi-key.md]
layer: server
refs:
  - "[code://packages/server/src/commands/plugin.ts#L540-L560](../../../../packages/server/src/commands/plugin.ts#L540-L560) - `plugin config set`: the command shape to copy"
  - "[code://packages/server/src/commands/config.ts#L171-L205](../../../../packages/server/src/commands/config.ts#L171-L205) - `ahpd config`, which the two commands sit beside"
  - "[code://packages/server/src/rootconfig.ts#L360-L390](../../../../packages/server/src/rootconfig.ts#L360-L390) - a client's write: the new name, the old name removed, and `checkConfig` before `writeEntry`"
---

## Objective

`ahpd config set <key> <value>` writes one daemon setting, and `ahpd config unset <key>` removes it.

## Files

- `UPDATE: packages/server/src/commands/config.ts` - the `config set` and `config unset` commands.
- `UPDATE: packages/server/src/commands/registry.ts` - register both for the terminal.
- `UPDATE: packages/server/src/commands/served.ts` - register both for `/api`.
- `CREATE: packages/server/test/config-set.test.ts` - cases for a set, an unset, a bad value, an unknown key and an old name.

## Steps

1. Read the value as JSON when it parses, and as text otherwise, with `typedValue`.
2. Refuse a key that is not a setting, and refuse `plugins` with a pointer to `ahpd plugin`.
3. Write the key under its new name, and remove its old name.
4. Run `checkConfig` on the whole file before `writeEntry`, so a bad value writes nothing.
5. Write the daemon's own file when served, and `--config-file` or the default file otherwise.
6. Say `Set <key>.` or `Unset <key>.`, and the restart line when a daemon runs.
7. Give both commands the scope `config:write`.
8. Add the cases.

## Validation

- `ahpd config set modelApi true` writes `"modelApi": true`, and `ahpd config unset modelApi` removes it.
- `ahpd config set httpApi true` on a file with `http` leaves only `httpApi`.
- `pnpm --filter @ahpd/server test` passes, run alone.

## Resume

- **Done so far:** every step.
- **Found:** a refusal throws out of `Program.run`, so the cases expect the throw, as `plugin-config.test.ts` does.
