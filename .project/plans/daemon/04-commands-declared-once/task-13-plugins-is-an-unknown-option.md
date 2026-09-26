---
title: --plugins is an unknown option again
status: todo
depends: [task-12-cofold-fields-say-whether-they-negate.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L185-L188](../../../../packages/server/src/commands/options.ts#L185-L188) - `noPlugins`, spelled `--no-plugins`"
---

## Objective

`ahpd --plugins` exits 2 with `Unknown option --plugins.`, as the hand-written CLI did, and completion never offers it.

## Files

- `UPDATE: packages/server/src/commands/options.ts:185-188` - `noPlugins`' `cli` gains `negatable: false`.
- `UPDATE: test/server-cli.test.ts` - the refusal case.

## Steps

1. Apply decision [no-plugins-has-no-positive](../../../decisions/no-plugins-has-no-positive.md): declare `noPlugins` with `cli: { negatable: false }`, relying on the cofold release from task 12.
2. Leave `--no-plugins` itself and its fold in `optionsFrom` as they are.

## Validation

- `test/server-cli.test.ts`, case "refuses --plugins": `['--plugins', '--stdio', '--config-file', config]` exits 2 and stderr contains `Unknown option --plugins`. Today it parses, reaches the run and exits 1 with "No backend is loaded".
- `['__complete', '--', 'start', '--plu']` offers `--plugin` and not `--plugins`.
- `node_modules/.bin/vitest run test/server-cli.test.ts` green.

## Resume
