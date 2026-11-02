---
title: Claude takes only the keys it declares
status: todo
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/config.ts#L86-L124](../../../../packages/agent-claude/src/session/config.ts#L86-L124) - `permissionFor`"
  - "[code://packages/agent-claude/src/session/config.ts#L236-L305](../../../../packages/agent-claude/src/session/config.ts#L236-L305) - `setConfig`"
  - "[code://packages/sdk/test/conformance.test.ts#L855-L990](../../../../packages/sdk/test/conformance.test.ts#L855-L990) - the cases that map the two keys"
---

## Objective

Claude's `setConfig` takes the keys its schema declares and the model.
`autoApprove` and `mode` are refused as keys this backend does not take.

## Files

- `UPDATE: packages/agent-claude/src/session/config.ts:86-124` - `permissionFor` goes, with its comment.
- `UPDATE: packages/agent-claude/src/session/config.ts:236-305` - `setConfig` reads `permissionMode` alone for the mode.
- `UPDATE: packages/agent-claude/src/session.ts:22` - the export of `permissionFor` goes.
- `UPDATE: packages/sdk/test/conformance.test.ts:855-990` - the two keys are refused, and the mapping's unit case goes.

## Steps

1. Remove `permissionFor` and its export.
2. Read only `permissionMode` for the mode in `setConfig`.
3. Refuse any other key with this backend's sentence for a key it does not take.
4. Replace the mapping's cases with one that sends both keys and reads the refusals.

## Validation

- `packages/sdk/test/conformance.test.ts`: the new case fails on `89ebe4d5` and passes after.
- The agent-claude and sdk test files pass.
- `pnpm run typecheck` is clean.

## Resume
