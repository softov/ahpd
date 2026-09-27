---
title: Commit asks first, naming its subject and its files
status: todo
depends: [task-02-commit-takes-the-index-when-staged.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L809-L834](../../../../packages/sdk/src/changes.ts#L809-L834) - `operations`, where `COMMIT` is offered"
  - "[code://packages/sdk/src/types/changes.ts#L171-L211](../../../../packages/sdk/src/types/changes.ts#L171-L211) - `ChangesetOperationContext`, which has no `subject`, and the request that has one"
  - "[code://packages/sdk/src/host.ts#L2292-L2342](../../../../packages/sdk/src/host.ts#L2292-L2342) - `operationsOf`, which passes `confirmation` through, and `operationsMoved`"
  - "[code://packages/sdk/src/host.ts#L4458-L4470](../../../../packages/sdk/src/host.ts#L4458-L4470) - `renameChat`, where a client or the `rename_chat` tool renames a session"
  - "[code://packages/sdk/src/host.ts#L6756](../../../../packages/sdk/src/host.ts#L6756) - the title given to `invoke` as `subject`"
---

## Objective

The `commit` operation carries a `confirmation` naming the subject line it will use and the files it will take, and the sentence stays true as the files, the index and the title change, per decision [a-commit-asks-first-and-names-what-it-takes](../../../decisions/a-commit-asks-first-and-names-what-it-takes.md).

## Files

- `UPDATE: packages/sdk/src/types/changes.ts:171-211` - `subject` moves onto `ChangesetOperationContext`, so `operations` has it too.
- `UPDATE: packages/sdk/src/host.ts` - the context handed to `operations` carries the title; a title change re-declares the session's operations with `operationsMoved`.
- `UPDATE: packages/sdk/src/changes.ts:809-834` - `COMMIT` is built per call with its `confirmation`.
- `UPDATE: packages/sdk/test/commit.test.ts` and a host case - the cases below.

## Steps

1. Give `ChangesetOperationContext` the `subject`, and have the host fill it where it builds the context for `operations` as it does for `invoke`.
2. In `operations`, build `COMMIT` with a `confirmation` from what `look` last held: with anything staged, "Commit N staged files as '<subject>'?"; with nothing staged, "Commit N files, M untracked, as '<subject>'?", with "1 file" in the singular and the untracked part left out when there are none.
   `<subject>` is the one `invoke` would use when no message is sent.
3. Call `operationsMoved` for the session wherever its title changes: `renameChat`, and a title a backend emits.
4. Invoke still decides from the index at the moment it runs, so a confirmation shown before a change it has not heard of never commits something other than git's state.

## Validation

- `commit.test.ts`: with `a.txt` staged and `b.txt` modified, `operations` for the uncommitted scope offers `commit` whose `confirmation` is "Commit 1 staged file as 'Fix the build'?" for subject "Fix the build"; with nothing staged and one untracked file among three, it is "Commit 3 files, 1 untracked, as 'Fix the build'?".
  Today `commit` has no `confirmation`.
- A host case: renaming the session sends `changeset/operationsChanged` on a watched uncommitted changeset whose `commit` confirmation names the new title.
- `pnpm typecheck` and `node_modules/.bin/vitest run packages/sdk` green.

## Resume
