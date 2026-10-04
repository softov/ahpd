---
title: Files and chats are test files of their own
status: implemented
depends: [task-05-tools-and-terminals.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host.test.ts#L15-L22](../../../../packages/sdk/test/host.test.ts#L15-L22) - `REPO` and its comment, read only by `the host's filesystem` and `completing an at-sign`"
  - "[code://packages/sdk/test/host.test.ts#L2991-L3072](../../../../packages/sdk/test/host.test.ts#L2991-L3072) - `where the agent works`"
  - "[code://packages/sdk/test/host.test.ts#L3726-L3878](../../../../packages/sdk/test/host.test.ts#L3726-L3878) - `the host's filesystem, as far as a client may see it`"
  - "[code://packages/sdk/test/host.test.ts#L3880-L3922](../../../../packages/sdk/test/host.test.ts#L3880-L3922) - `completing an at-sign`"
  - "[code://packages/sdk/test/host.test.ts#L4799-L4975](../../../../packages/sdk/test/host.test.ts#L4799-L4975) - `more than one directory`"
  - "[code://packages/sdk/test/host.test.ts#L3924-L3961](../../../../packages/sdk/test/host.test.ts#L3924-L3961) - `two people on one chat`"
  - "[code://packages/sdk/test/host.test.ts#L5798-L5946](../../../../packages/sdk/test/host.test.ts#L5798-L5946) - `dropping the turns after one`"
  - "[code://packages/sdk/test/host.test.ts#L5948-L6149](../../../../packages/sdk/test/host.test.ts#L5948-L6149) - `a chat made out of another`; reads `checker`"
  - "[code://packages/sdk/test/host.test.ts#L6151-L6307](../../../../packages/sdk/test/host.test.ts#L6151-L6307) - `more than one chat in a session`"
---

## Objective

`host-files.test.ts` holds where a session works and what of the host's filesystem a client may see, and `host-chats.test.ts` holds a session's chats: shared drafts, truncation, forks and more than one chat; every test moved unchanged.

## Files

- `CREATE: packages/sdk/test/host-files.test.ts` - `REPO` with its comment, `where the agent works`, `the host's filesystem, as far as a client may see it`, `completing an at-sign`, `more than one directory`; 25 tests, about 485 lines.
- `CREATE: packages/sdk/test/host-chats.test.ts` - `two people on one chat`, `dropping the turns after one`, `a chat made out of another`, `more than one chat in a session`; 21 tests, about 565 lines.
- `UPDATE: packages/sdk/test/host.test.ts` - those blocks and `REPO` removed; 66 tests left.

## Steps

1. Find each block in `host.test.ts` by its `describe` or `it` name; the line numbers here are at `b4f1a4b` and task 01 shifted them.
2. Cut each block with the block comment above it, unchanged, into its new file, in the order the blocks stand in `host.test.ts`.
3. Open each new file with its `vitest` import, `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)`, an import from `./support/host.js` of only the names its blocks read, the other imports its blocks read (types, `Status`, `fileSessions`, `memorySessions`, `node:` modules, `checker`, `PROTOCOL_VERSION`) with the same specifiers, and `beforeEach(resetSdk)`.
4. Drop from `host.test.ts` the imports none of its remaining blocks reads.
5. `REPO` moves with its comment to the top of `host-files.test.ts`, after the imports; its `new URL('../../..', import.meta.url)` is unchanged because the file stays in `packages/sdk/test/`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- `pnpm exec vitest list packages/sdk | wc -l` equals the count recorded before task 01 (1,316 at `b4f1a4b`), and `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals the list task 01 saved, sorted the same way.
- `pnpm exec vitest list packages/sdk/test/host-files.test.ts` lists 25 tests, and `host-chats.test.ts` 21.
- `wc -l` of each new file, recorded in *Resume*, is under 800.

## Resume

- **Done:** implemented 2026-10-04. `host-files.test.ts` is 481 lines and `host-chats.test.ts` is 560, both under 800. `host.test.ts` has 66 tests left. `REPO` moved with its comment to the top of `host-files.test.ts`; its `new URL('../../..', import.meta.url)` is unchanged because the file stays in `packages/sdk/test/`.
- **Counts:** `vitest list` gives 25 for files and 21 for chats, the numbers the plan predicted.
- **Gates:** `pnpm exec tsc --noEmit` and `pnpm boundary` pass. `pnpm exec vitest run packages/sdk` passes, 1,334 tests in 93 files. The sorted-name fingerprint is `532860aa4c087b69e30d8a47dcead5f4`, unchanged.
- **Next action:** [task-07-names-snapshots-and-github.md](task-07-names-snapshots-and-github.md).
- **Open questions:** none.
- **Watch out for:** `host.test.ts` still reads `REPOS`, a constant of its own inside `what GitHub knows about the branch`'s neighbours. It is a different name from the `REPO` that moved, and `\bREPO\b` does not match it, so the two do not collide.
