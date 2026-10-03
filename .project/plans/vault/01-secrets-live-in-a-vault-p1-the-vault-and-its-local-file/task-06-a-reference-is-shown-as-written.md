---
title: A reference is shown as written
status: done
depends: [task-01-the-vault-port-and-the-scope-rule.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/config.ts#L62-L100](../../../../packages/server/src/commands/config.ts#L62-L100) - `walk`, `maskValue`, `maskOption`"
  - "[code://packages/server/src/rootconfig.ts#L62-L70](../../../../packages/server/src/rootconfig.ts#L62-L70) - `askedOf`, which drops a `<set>` a client sends back"
  - "[code://packages/server/src/rootconfig.ts#L210-L230](../../../../packages/server/src/rootconfig.ts#L210-L230) - a root config write checks each option against its schema"
  - "[code://packages/server/src/commands/plugin.ts#L253-L266](../../../../packages/server/src/commands/plugin.ts#L253-L266) - `plugin option` checks a value against its schema"
  - "[code://packages/server/test/plugin-mask.test.ts](../../../../packages/server/test/plugin-mask.test.ts) - the mask's cases"
  - "[code://packages/server/test/server-root-config.test.ts](../../../../packages/server/test/server-root-config.test.ts) - root config's cases"
---

## Objective

An option written `{ "$secret": "<name>" }` is answered as that reference by root config, `config`, `plugin list` and `plugin config`, `writeOnly` or not, and a client or `ahpd plugin option` may write one where the schema asks for a string.

## Files

- `UPDATE: packages/server/src/commands/config.ts:62-69` - `walk` answers a `secretRef` value as it is, before the `writeOnly` check.
- `UPDATE: packages/server/src/commands/config.ts:99-100` - `maskOption` with no schema answers a reference as it is, and `<set>` for anything else, as now.
- `UPDATE: packages/server/src/rootconfig.ts:210-230` and `packages/server/src/commands/plugin.ts:253-266` - a reference is checked with `scopeOf` instead of the option's schema.
- `UPDATE: packages/server/test/plugin-mask.test.ts`, `packages/server/test/server-root-config.test.ts` - the cases below.

## Steps

1. Nothing else changes in the mask: a plain-text `writeOnly` value still answers `<set>`.
2. A malformed reference (`{ "$secret": "x" }`) is refused at the write with `scopeOf`'s message.

## Validation

- `plugin-mask.test.ts`: a `writeOnly` option holding a reference answers the reference; one holding plain text answers `<set>`; a plugin with no schema answers a reference as written.
- `server-root-config.test.ts`: writing `{ "$secret": "host:x" }` to a string option is kept in the file; `{ "$secret": "x" }` is refused.
- `pnpm -F @ahpd/server test`.

## Resume
