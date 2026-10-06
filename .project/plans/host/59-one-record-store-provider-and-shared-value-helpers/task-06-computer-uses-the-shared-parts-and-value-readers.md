---
title: Computer uses the shared parts and value readers
status: todo
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
