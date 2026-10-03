---
title: The old names are gone, from ahpd and from the wire test
status: todo
depends: [task-01-the-commit-message-is-read-as-ahpd-commit.md, task-02-owner-sender-and-staging-are-ahpd-keys.md, task-03-claudes-model-and-skill-hint-are-ahpd-keys.md, task-04-usage-extensions-are-ahpd-keys.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/changes.ts#L1068-L1069](../../../../packages/sdk/src/changes.ts#L1068-L1069) - the `ahp.commit` fallback task 01 left"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - p1's `PENDING` list"
  - "file:///github/ahpapp/src/changeset-ops.ts - line 207, which must send `ahpd.commit` first"
---

## Objective

ahpd reads no `ahp.commit`, the wire test's `PENDING` list is empty and gone, and `docs/AHP.md` names only `ahpd.` keys for ahpd's extensions.

## Files

- `UPDATE: packages/sdk/src/changes.ts:1068-1069` - drop the `ahp.commit` fallback.
- `UPDATE: packages/sdk/test/commit.test.ts` - `ahp.commit` is ignored.
- `UPDATE: packages/sdk/test/wire.test.ts` - remove `PENDING`; a bare invented key fails the census.
- `UPDATE: docs/AHP.md` - one paragraph saying ahpd's own `_meta` keys are `ahpd.<name>` and the reference's are kept as the reference spells them.

## Steps

1. Confirm ahpapp's release sends `ahpd.commit`; do not merge before.
2. If open question 1 is answered yes, the timing keys are renamed here too, after a superseding decision exists and plugin/29 is amended.

## Validation

- `packages/sdk/test/wire.test.ts` passes with no `PENDING` list, and fails when any producer sends a bare invented key.
- `commit.test.ts`: a message under `ahp.commit` is not used.
- `pnpm test` passes.

## Resume
