---
title: Computer uses the shared parts and value readers
status: done
depends: [task-05-the-plugins-sdk-peer-range-names-the-sdk-that-exports-the-helpers.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/provider.ts#L102-L122](../../../../packages/computer/src/provider.ts#L102-L122) - `split`, `absent`, `at`"
  - "[code://packages/computer/src/provider.ts#L217-L218](../../../../packages/computer/src/provider.ts#L217-L218) - `asFile`"
  - "[code://packages/computer/src/manifest.ts#L535-L552](../../../../packages/computer/src/manifest.ts#L535-L552) - `bodyText` and `bodyOf`"
  - "[code://packages/computer/src/runtime.ts#L640-L641](../../../../packages/computer/src/runtime.ts#L640-L641) - the owner regex"
  - "[code://packages/computer/src/plugin.ts#L130-L131](../../../../packages/computer/src/plugin.ts#L130-L131) - `words`, a string list that answers `undefined` for a non-array"
---

## Objective

Computer's provider takes the URI split, the absent refusal, `asFile` and `bodyText` from `@ahpd/sdk`, and its owner check from `ownerOf`; its leaves, owner-aware writes, `watch` and `moment` stay its own.

## Files

- `UPDATE: packages/computer/src/provider.ts:102-122,217-218` - `split` over `splitResource(uri, 'computer')`; `absent` is `absentResource('computer', uri)`; `asFile` imported.
- `UPDATE: packages/computer/src/manifest.ts:535-536` - `bodyText` imported and re-exported for `provider.ts`; `bodyOf` keeps its own first sentence, which names the manifest's fields.
- `UPDATE: packages/computer/src/runtime.ts:640-641` - `ownerOf` imported.
- `UPDATE: packages/computer/src/plugin.ts:130-131` - `words` stays, because it answers `undefined` rather than `[]`; it may be written over `strings` for an array.

## Steps

1. Take the parts only; `computerProvider` is not a `recordsProvider`.
2. `moment` stays: it is a machine's creation date, not the epoch.

## Validation

- A pure refactor: every `packages/computer/test` file stays green unchanged, including the wrong-scheme case host 58 task 06 added.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test packages/computer`.

## Resume

`provider.ts` takes `splitResource`, `absentResource` and `asFile` from `@ahpd/sdk`. Its `split` keeps the local two-field `At` and its `undefined` answer (the shared reader's refusal for a wrong scheme is caught, because `at` is the one place that says so out loud), and its nine `throw absent(uri)` are `throw absentResource('computer', uri)`. The local `absent` and the local `asFile` are gone. Leaves, owner-aware writes, `watch` and `moment` are untouched - `computerProvider` is still not a `recordsProvider`, and `moment` is still a machine's creation date.

`manifest.ts` imports `bodyText` from `@ahpd/sdk` and re-exports it, so `provider.ts`'s `import { bodyText } from './manifest.js'` is unchanged and `bodyOf` still decodes through it. `bodyOf` is otherwise as it was: its own first refusal still names the manifest's five fields. The plan's line numbers are stale throughout this task (host 58 moved them); `bodyText`/`bodyOf` are at 662-685 and the read decode at 396-400 of `provider.ts`'s neighbours.

`runtime.ts`'s `ownerSaid` is now `ownerOf` from `@ahpd/sdk`, exported under this file's own name for it (`export const ownerSaid = ownerOf;`) so the import in `owners.ts` and both call sites are unchanged - a machine's label "says" whose it is, which is computer's word rather than the sdk's. The regex is gone.

`plugin.ts`'s `words` is `Array.isArray(value) ? strings(value) : undefined`: it still answers `undefined` for a value that is not a list, which is what the caller's `=== undefined` checks read, and the filter it wrote by hand is now the shared one.

Gates: `pnpm build` clean, `npx vitest run packages/computer --maxWorkers=2 --testTimeout=10000` 24 files and 403 tests passed, unchanged from before this task.
