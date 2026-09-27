---
title: --plugins is an unknown option again
status: done
depends: [task-12-cofold-fields-say-whether-they-negate.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L195-L199](../../../../packages/server/src/commands/options.ts#L195-L199) - `noPlugins`, spelled `--no-plugins`, with no positive spelling"
  - "[code://packages/server/test/server-cli.test.ts#L301-L305](../../../../packages/server/test/server-cli.test.ts#L301-L305) - the refusal case"
  - "[code://packages/server/test/server-cli.test.ts#L228-L233](../../../../packages/server/test/server-cli.test.ts#L228-L233) - the completion case"
---

## Objective

`ahpd --plugins` exits 2 with `Unknown option --plugins.`, as the hand-written CLI did, and completion never offers it.

## Files

- `UPDATE: packages/server/src/commands/options.ts:195-199` - `noPlugins`' `cli` gains `negatable: false`.
- `UPDATE: packages/server/test/server-cli.test.ts:228-233, 301-305` - the completion and refusal cases.

## Steps

1. Declare `noPlugins` with `cli: { negatable: false }`, relying on the cofold release from task 12.
2. Leave `--no-plugins` itself and its fold in `optionsFrom` as they are.

## Validation

- `packages/server/test/server-cli.test.ts`, case "refuses --plugins": `['--plugins', '--stdio', '--config-file', config]` exits 2 and stderr contains `Unknown option --plugins`. Today it parses, reaches the run and exits 1 with "No backend is loaded".
- `['__complete', '--', 'start', '--plu']` offers `--plugin` and not `--plugins`.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Done.
`noPlugins` is declared with `cli: { negatable: false }`, so `@cofold/commands` 0.2.1 does not register `--plugins` as its positive: the option is unknown and the program refuses it with exit 2.
`--no-plugins` and the fold in `optionsFrom` are unchanged.
`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green, 39 cases; `pnpm typecheck` green.
