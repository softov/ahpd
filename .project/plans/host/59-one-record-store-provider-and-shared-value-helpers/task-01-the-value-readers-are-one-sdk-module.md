---
title: The value readers are one sdk module
status: done
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

`packages/sdk/src/values.ts` holds the six: `isRecord`, `bag` (an object only, `{}` for an array), `str`, `strings`, `reason` and `ownerOf`, each over the definition the copies already agreed on. `packages/sdk/src/index.ts` exports them beside `secretRef`, `packages/sdk/src/host/common.ts` re-exports `reason` from `../values.js` so `host.ts` and `host/vscodemethods.ts` keep their import path, and `packages/sdk/test/values.test.ts` is the new file's cases (13).

Replaced, in this order: `host/common.ts` (`reason`), `scheduled.ts` (`owned` and `bag`, `owned` renamed `ownerOf` at its two call sites and the now-unused `Owner` type import dropped), `sessions.ts` (`ownerOf`), `users.ts` (`strings`); `server/src/plugins.ts` (`messageOf` and `isRecord`, `messageOf` renamed `reason` at its ten call sites), `server/src/proxy/providers.ts` and `server/src/commands/options.ts` (`isObject` renamed `isRecord`), `server/src/config.ts` (`why` renamed `reason`).

Four more definitions are inside `packages/*/src` and the plan's own final checklist names them (`rg -n "^const (bag|bagOf|str|isRecord|isObject) =" packages/*/src` finds only `values.ts`), but no task's Files list does, so this is the one judgment call in the task: step 7 says "replace the sdk and server definitions" and the checklist says only `values.ts` may hold one, so they went too. `packages/sdk/src/automations.ts`, `packages/sdk/src/host/automations.ts` and `packages/sdk/src/attachments.ts` take `bag` from `./values.js` and `../values.js`, and `packages/server/src/proxy/dialects.ts` takes `isRecord` from `@ahpd/sdk`. The first two already refused arrays, so their behaviour is unchanged; `attachments.ts`'s copy admitted one, and every call site there was read first: `partOf`, `referenceFor`, `typeFor`, `isSnapshot` and `selectionOf` all read named fields off the answer (`one.type`, `one._meta`, `one.selection`), where an array answered `undefined` before and answers `undefined` now, so no site expects a list and none needed `strings`. `packages/sdk/src/host/automations.ts:82` keeps a local `ownerOf`, which is not this reader: it takes an `AutomationEntry` and reads `_meta`, so a task that wants it folded in has to say which call site takes the shared one.

No call site of the copies this task replaced expects a list either: `scheduled.ts` reads `trigger.kind`, `trigger.schedule`, `trigger.id` and `one.definition`, and the server's four read named fields and schema keys, so nothing changed to a `strings` read.

Gates: `pnpm build` clean, `pnpm typecheck` clean, `pnpm boundary` clean (9 packages, none undeclared), `npx vitest run packages/sdk packages/server` 161 files and 3190 tests passed, `pnpm install` reused the store unchanged. The final checklist's grep now matches only the four agent packages, which is task 07's.
