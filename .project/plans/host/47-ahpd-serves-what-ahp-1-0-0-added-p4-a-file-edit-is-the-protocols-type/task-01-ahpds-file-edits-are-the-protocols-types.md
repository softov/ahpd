---
title: ahpd's file edits are the protocol's types
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/changes.ts#L10-L27](../../../../packages/sdk/src/types/changes.ts#L10-L27) - the local `ContentRef` and `FileEdit`"
  - "[code://packages/sdk/src/types/changes.ts#L3-L7](../../../../packages/sdk/src/types/changes.ts#L3-L7) - the file already imports types from the protocol package"
---

## Objective

`FileEdit` and `ContentRef` exported from `packages/sdk/src/types/changes.ts` are the protocol's types, with no change to anything sent.

## Files

- `UPDATE: packages/sdk/src/types/changes.ts:10-27` - drop the two local interfaces; `export type { ContentRef, FileEdit, FileEditSide, FileEditCollection } from '@microsoft/agent-host-protocol'`, and import `FileEdit` for `ChangesetFile`.

## Steps

1. Replace the types; keep the doc comment that says `before` absent is a creation and `after` absent a deletion, on the re-export.
2. Fix whatever `tsc` then finds in `packages/sdk/src/changes.ts` without a cast; a cast is a defect to report in Resume.

## Validation

- `pnpm exec tsc --noEmit` and `pnpm boundary` pass.
- `rg -n "before\?: \{ uri" packages/*/src` finds nothing.
- `pnpm exec vitest run packages/sdk/test/changes-uris.test.ts packages/sdk/test/changes-refresh.test.ts` passes unchanged.

## Resume
