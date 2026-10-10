---
title: The host's tools read their input one way
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/artifacts.ts#L42-L46](../../../../packages/sdk/src/tools/artifacts.ts#L42-L46) - `requireString`, four uses, which trims"
  - "[code://packages/sdk/src/tools/session.ts#L49-L69](../../../../packages/sdk/src/tools/session.ts#L49-L69) - `required`, `optional`, `flag`, `when`, 27 uses"
  - "[code://packages/sdk/test/sessiontools.test.ts](../../../../packages/sdk/test/sessiontools.test.ts) - the tools' cases"
  - "[code://packages/sdk/test/artifacttools.test.ts](../../../../packages/sdk/test/artifacttools.test.ts) - the artifact tools' cases"
---

## Objective

`packages/sdk/src/toolinput.ts` holds one reader per kind of tool input field, and the artifact and session tools use it; every refusal says what it says today.

## Files

- `CREATE: packages/sdk/src/toolinput.ts` - `required`, `optional`, `flag`, `when`, each `(value, field, tool)`, from `tools/session.ts`; internal, not exported from the package.
- `CREATE: packages/sdk/test/toolinput.test.ts` - the helper's cases.
- `UPDATE: packages/sdk/src/tools/session.ts:49-69` - imports instead of defines.
- `UPDATE: packages/sdk/src/tools/artifacts.ts:42-46` - `requireString` goes; each of its four calls is `required(...).trim()`, so what it answers is unchanged.

## Steps

1. `required` answers the value as given, as `tools/session.ts` does; trimming stays at the artifact tools' call sites.

## Validation

- `toolinput.test.ts`, a new helper's cases: each reader's accepted value and its refusal sentence.
- A pure refactor: `sessiontools.test.ts` and `artifacttools.test.ts` stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume

- **Implemented** 2026-10-09 on `build/agents/379ac04c`.
- `packages/sdk/src/toolinput.ts` holds the four readers, `required`, `optional`, `flag` and `when`, each `(value, field, tool)`. It is not exported from `@ahpd/sdk`.
- `packages/sdk/src/tools/session.ts:4` imports them instead of defining them. Its 27 uses and every sentence are unchanged.
- `packages/sdk/src/tools/artifacts.ts` lost `requireString`; its four calls are now `required(...).trim()`, so each answers what it answered.
- `packages/sdk/test/toolinput.test.ts` is 8 cases over the four readers: the value each accepts and the sentence each refuses with. `sessiontools.test.ts` and `artifacttools.test.ts` are unchanged and green.
- The remove tool's inline check on `id` stayed. It does not trim, so `required` would refuse a whitespace-only id that today reaches the store, and this task changes no answer.
- Gates: `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and the full suite pass, 4768 tests over 268 files.
