---
title: The strict schema follows the installed package
status: todo
depends: [task-02-the-package-is-1-0-0-and-the-highest-version-wins.md]
layer: "tools, sdk"
refs:
  - "[code://tools/schema.mjs#L27-L32](../../../../tools/schema.mjs#L27-L32) - resolves the package's entry, beside which its `package.json` lies"
  - "[code://tools/schema.mjs#L276-L285](../../../../tools/schema.mjs#L276-L285) - the object it writes"
  - "[code://tools/wire.mjs#L27-L28](../../../../tools/wire.mjs#L27-L28) - `SCHEMA`, the path both readers share"
  - "[code://tools/wire.mjs#L131](../../../../tools/wire.mjs#L131) - ajv with `strict: false`, so an extra top-level key is not refused"
  - "[code://packages/sdk/test/wire.test.ts#L339-L345](../../../../packages/sdk/test/wire.test.ts#L339-L345) - rebuilds only when the file is missing"
---

## Objective

`tools/ahp.strict.schema.json` names the package version it was generated from, and the wire test regenerates it whenever that is not the installed version, so a bare `vitest run` after a bump never checks against the old protocol.

## Files

- `UPDATE: tools/schema.mjs` - the output carries the installed package's version as a top-level key (`ahpVersion`), read from the package's own `package.json`.
- `UPDATE: tools/wire.mjs` - an exported `stale()` that answers true when the file is missing, unreadable, or names another version than the installed one.
- `UPDATE: packages/sdk/test/wire.test.ts:339-345` - regenerate when `stale()` is true.

## Steps

1. In `schema.mjs`, find the package's `package.json` from the resolved entry and add its `version` to `out`.
2. In `wire.mjs`, `stale()` reads both versions the same way; `tools/validate.mjs` can call it too, and says so when the schema is stale rather than regenerating it.
3. Replace the `existsSync` guard with `stale()`.

## Validation

- A test beside the `a capture line` block: a schema file with `ahpVersion: '0.0.1'` is stale, one with the installed version is not, and a missing file is stale.
- By hand, offline: `node tools/schema.mjs`, then edit the file's `ahpVersion`, then `pnpm exec vitest run packages/sdk/test/wire.test.ts` regenerates it (the generator prints its line) and passes.

## Resume
