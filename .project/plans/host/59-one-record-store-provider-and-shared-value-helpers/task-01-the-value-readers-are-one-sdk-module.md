---
title: The value readers are one sdk module
status: todo
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/host/common.ts#L17](../../../../packages/sdk/src/host/common.ts#L17) - `reason`, which moves"
  - "[code://packages/sdk/src/scheduled.ts#L57-L58](../../../../packages/sdk/src/scheduled.ts#L57-L58) - `owned`"
  - "[code://packages/sdk/src/scheduled.ts#L72](../../../../packages/sdk/src/scheduled.ts#L72) - `bag`"
  - "[code://packages/sdk/src/sessions.ts#L121-L122](../../../../packages/sdk/src/sessions.ts#L121-L122) - `ownerOf`"
  - "[code://packages/sdk/src/users.ts#L367-L369](../../../../packages/sdk/src/users.ts#L367-L369) - `strings`"
  - "[code://packages/server/src/plugins.ts#L232-L236](../../../../packages/server/src/plugins.ts#L232-L236) - `messageOf` and `isRecord`"
  - "[code://packages/server/src/proxy/providers.ts#L160](../../../../packages/server/src/proxy/providers.ts#L160) - `isObject`"
  - "[code://packages/server/src/commands/options.ts#L205](../../../../packages/server/src/commands/options.ts#L205) - `isObject`"
  - "[code://packages/server/src/config.ts#L319](../../../../packages/server/src/config.ts#L319) - `why`, the error message"
  - "[code://packages/sdk/src/index.ts#L59](../../../../packages/sdk/src/index.ts#L59) - the export line to sit beside"
---

## Objective

`packages/sdk/src/values.ts` exports `isRecord`, `bag`, `str`, `strings`, `reason` and `ownerOf` from `@ahpd/sdk`, and the sdk and server copies are gone.

## Files

- `CREATE: packages/sdk/src/values.ts` - the six readers, one doc line each.
- `CREATE: packages/sdk/test/values.test.ts` - the helper's cases.
- `UPDATE: packages/sdk/src/index.ts` - `export { bag, isRecord, ownerOf, reason, str, strings } from './values.js';`.
- `UPDATE: packages/sdk/src/host/common.ts:17` - `reason` re-exported from `../values.js`, so the `host/*.ts` imports stay.
- `UPDATE: packages/sdk/src/scheduled.ts:57-58,72`, `packages/sdk/src/sessions.ts:121-122`, `packages/sdk/src/users.ts:367-369` - import instead of define.
- `UPDATE: packages/server/src/plugins.ts:232-236`, `proxy/providers.ts:160`, `commands/options.ts:205`, `config.ts:319` - import from `@ahpd/sdk`, which the server already depends on.

## Steps

1. `isRecord(value)`: a non-null object that is not an array, as the server's three copies say.
2. `bag(value)`: `value` when `isRecord(value)`, else `{}`, so an array is never read as an object. Before replacing a copy, read each of its call sites: one that is handed a list reads it with `strings` or an array check instead of `bag`, and that change is named in the task's Resume.
3. `str(value)`: a string or `undefined`.
4. `strings(value)`: the strings in an array, `[]` for anything else.
5. `reason(error)`: `error.message` for an `Error`, else `String(error)`.
6. `ownerOf(value)`: a string matching `/^(?:user|team|project|root):.+$/` as an `Owner`, else `undefined`.
7. Replace the sdk and server definitions; leave the inline uses that are not on a line already being edited.

## Validation

- `values.test.ts`, a new helper's cases: `bag([1])` is `{}` and `isRecord([1])` is false; `bag(null)` and `bag('x')` are `{}`; `strings(['a', 1, 'b'])` is `['a', 'b']`; `reason(new Error('x'))` is `x` and `reason(3)` is `3`; `ownerOf('team:a')` is `team:a`, `ownerOf('team:')` and `ownerOf('teams:a')` are `undefined`.
- A pure refactor: the existing sdk and server suites stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test packages/sdk packages/server`.

## Resume
