---
title: ahpd's file edits are the protocol's types
status: done
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

- **Implemented** 2026-10-09 on `build/agents/5860f22a`.
- The local `ContentRef` (10-15) and `FileEdit` (17-27) are gone. `FileEdit` joins the existing protocol import at the top of `packages/sdk/src/types/changes.ts`, which is what `ChangesetFile.edit` now names.
- The re-export carries the doc comment: `export type { ContentRef, FileEdit, FileEditSide, FileEditCollection } from '@microsoft/agent-host-protocol'`. The comment now opens on the two reasons for taking the protocol's names, and keeps the sentence about `before` absent being a creation and `after` absent a deletion.
- **No cast was needed, and step 2 found nothing to fix.** `packages/sdk/src/changes.ts` never names `FileEdit` or `ContentRef`: it imports `ChangesSummary`, `ChangesetFile`, `ChangesetOperation`, `ChangesetOperationResult`, `ChangesetSource` and `ChangesetState` only. The two places it builds the shape (`rowsOf` at 512-518 and the git row at 629-638) assign to `ChangesetFile.edit` structurally, and the protocol's `FileEditSide`, `FileEditDiffStats` and `ContentRef` accept them unchanged: `URI` is `string`, and the protocol's `ContentRef` only adds an optional `nonce`.
- `FileEditDiffStats` is not re-exported, since the task's Files line names four types and nothing here builds a `diff` by that name. `changes.ts` leaves `diff` to be inferred from `ChangesetFile.edit`, which is the protocol's type.
- `packages/sdk/src/index.ts` does not export `types/changes.ts`, so the four names stay inside the package. That is what the plan's ACP row relies on: `agent-acp` still cannot import `FileEdit` from `@ahpd/sdk`.
- Validation: `pnpm exec tsc --noEmit` is silent, `node scripts/boundary.mjs` reports `@ahpd/sdk: 2 declared, none undeclared`, `grep -rn "before" packages/sdk/src/types/changes.ts` shows no hand-written side shape, and `pnpm exec vitest run packages/sdk/test/changes-uris.test.ts packages/sdk/test/changes-refresh.test.ts` passes 42 tests, unchanged.
