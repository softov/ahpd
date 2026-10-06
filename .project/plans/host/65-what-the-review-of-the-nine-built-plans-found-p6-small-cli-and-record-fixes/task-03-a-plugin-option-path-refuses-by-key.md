---
title: A plugin option path refuses by key, own keys only, never into a secret
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L231-L247](../../../../packages/server/src/commands/options.ts#L231-L247) - `setAt`"
  - "[code://packages/sdk/src/vault.ts#L62-L68](../../../../packages/sdk/src/vault.ts#L62-L68) - `secretRef`"
  - "[code://packages/server/test/server-commands.test.ts#L274-L280](../../../../packages/server/test/server-commands.test.ts#L274-L280) - the case that pins the value in the refusal"
---

## Objective

A `--plugin-option` path that cannot be set is refused naming the key it stopped at and never the value there; a step reads only a key the options hold as their own; and a step into a `{ "$secret": ... }` reference is refused.

## Files

- `UPDATE: packages/server/src/commands/options.ts:240-244` - the refusal names `where` and the kind of value (`a number`, `a list`, `a string`), not `JSON.stringify(held)`; today `--plugin-option a.token.x=1` over a string token prints the token on the terminal and in a log.
- `UPDATE: packages/server/src/commands/options.ts:240` - `Object.hasOwn(here, key) ? here[key] : undefined`; today `here[key]` reads `Object.prototype`, so `a.toString.x=1` is refused as "holds undefined" rather than set.
- `UPDATE: packages/server/src/commands/options.ts:240-245` - a held value that is a `secretRef` is refused naming the key; today `a.key.x=1` over `{ "$secret": "host:k" }` makes `{ "$secret": "host:k", "x": 1 }`, which is no longer a reference.
- `UPDATE: packages/server/test/server-commands.test.ts:274-280` - the cases below.

## Steps

1. Failing cases first: the refusal for `a.s.x=1` over `s: "x"` does not contain `"x"` and names `s`; `a.toString.x=1` sets `{ toString: { x: 1 } }`; `a.key.x=1` over `key: { "$secret": "host:k" }` is refused naming `key`. All three fail today.
2. Make the three changes in `setAt`.

## Validation

- The three cases fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/server/test/server-commands.test.ts`.

## Resume
