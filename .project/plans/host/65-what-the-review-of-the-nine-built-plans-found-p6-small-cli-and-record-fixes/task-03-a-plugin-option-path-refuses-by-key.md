---
title: A plugin option path refuses by key, own keys only, never into a secret
status: done
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

Implemented. Three changes in `setAt`, and a `kindOf` beside it that answers "a number", "a list", "a string", "a boolean", "null" or "a `<type>`" so the refusal says what is there and never what it holds. The held value is read as `Object.hasOwn(here, key) ? here[key] : undefined`, so a path through `toString` makes a key the way `mkdir -p` makes a directory rather than reading `Object.prototype`. And a held value `secretRef` answers a name for is refused then, before the step into it, because the object would still be there beside the key and would no longer be a reference at all; set whole, at the end of the path, it is a value like any other and the branch above takes it.

The three cases failed first, in the run of `-t "plugin-option"`: the kind case with `Received: "...and presets holds 5, ..."` against the expected `a number`; the own-key case with `ArgumentError: --plugin-option sets a.toString.x=1, and toString holds undefined, which is not an object the rest of the path could be set in.` thrown from `setAt` at options.ts:243; and the secret case with `expected [Function] to throw an error` because `{ "$secret": "host:k", x: 1 }` was made instead. The old case that pinned the value in the refusal - `['a.s.x=1', 's', '"x"']` - was rewritten to the kind of value, and its plugin's `s` is now a token-shaped string with `expect(said).not.toContain(...)`, so the not-printing is asserted rather than assumed.

Gates: `npx tsc -b` clean, `pnpm exec vitest run packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts` 110 passed.
