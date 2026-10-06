---
title: The host's tools read their input one way
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/artifacttools.ts#L42-L46](../../../../packages/sdk/src/artifacttools.ts#L42-L46) - `requireString`, four uses, which trims"
  - "[code://packages/sdk/src/sessiontools.ts#L49-L69](../../../../packages/sdk/src/sessiontools.ts#L49-L69) - `required`, `optional`, `flag`, `when`, 27 uses"
  - "[code://packages/sdk/test/sessiontools.test.ts](../../../../packages/sdk/test/sessiontools.test.ts) - the tools' cases"
  - "[code://packages/sdk/test/artifacttools.test.ts](../../../../packages/sdk/test/artifacttools.test.ts) - the artifact tools' cases"
---

## Objective

`packages/sdk/src/toolinput.ts` holds one reader per kind of tool input field, and the artifact and session tools use it; every refusal says what it says today.

## Files

- `CREATE: packages/sdk/src/toolinput.ts` - `required`, `optional`, `flag`, `when`, each `(value, field, tool)`, from `sessiontools.ts`; internal, not exported from the package.
- `CREATE: packages/sdk/test/toolinput.test.ts` - the helper's cases.
- `UPDATE: packages/sdk/src/sessiontools.ts:49-69` - imports instead of defines.
- `UPDATE: packages/sdk/src/artifacttools.ts:42-46` - `requireString` goes; each of its four calls is `required(...).trim()`, so what it answers is unchanged.

## Steps

1. `required` answers the value as given, as `sessiontools.ts` does; trimming stays at the artifact tools' call sites.

## Validation

- `toolinput.test.ts`, a new helper's cases: each reader's accepted value and its refusal sentence.
- A pure refactor: `sessiontools.test.ts` and `artifacttools.test.ts` stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
