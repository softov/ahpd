---
title: Names, snapshots and GitHub are test files of their own, and host.test.ts is gone
status: todo
depends: [task-06-files-and-chats.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host.test.ts#L6655-L6713](../../../../packages/sdk/test/host.test.ts#L6655-L6713) - `a chat asked for by the name a client computed` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L6715-L6832](../../../../packages/sdk/test/host.test.ts#L6715-L6832) - `a session a client names` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L6834-L6971](../../../../packages/sdk/test/host.test.ts#L6834-L6971) - `a session asked for by the name a client computed` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L6973-L7148](../../../../packages/sdk/test/host.test.ts#L6973-L7148) - `a session asked for by the name its creator used` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L3218-L3434](../../../../packages/sdk/test/host.test.ts#L3218-L3434) - `what it says it is doing`: the tool named, titles, cost and model"
  - "[code://packages/sdk/test/host.test.ts#L6346-L6628](../../../../packages/sdk/test/host.test.ts#L6346-L6628) - `the fields a client reads by name` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L7150-L7304](../../../../packages/sdk/test/host.test.ts#L7150-L7304) - `a session's annotations` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L7381-L7621](../../../../packages/sdk/test/host.test.ts#L7381-L7621) - `what GitHub knows about the branch`"
  - "[code://packages/sdk/test/host.test.ts#L7623-L7718](../../../../packages/sdk/test/host.test.ts#L7623-L7718) - `what a session recorded`"
  - "[code://packages/sdk/test/host.test.ts#L7720-L7945](../../../../packages/sdk/test/host.test.ts#L7720-L7945) - `the pull request a create-pr recorded`, with its own `afterEach`"
---

## Objective

`host-names.test.ts` holds the spellings of a session or chat URI a client may use, `host-snapshots.test.ts` holds what a client reads off a session and a chat, and `host-github.test.ts` holds the git and GitHub facts and the pull request a session recorded; `host.test.ts` no longer exists.

## Files

- `CREATE: packages/sdk/test/host-names.test.ts` - `a chat asked for by the name a client computed`, `a session a client names`, `a session asked for by the name a client computed`, `a session asked for by the name its creator used`; 25 tests, about 510 lines.
- `CREATE: packages/sdk/test/host-snapshots.test.ts` - `what it says it is doing`, `the fields a client reads by name`, `a session's annotations`; 25 tests, about 675 lines.
- `CREATE: packages/sdk/test/host-github.test.ts` - `what GitHub knows about the branch`, `what a session recorded`, `the pull request a create-pr recorded`; 16 tests, about 580 lines.
- `DELETE: packages/sdk/test/host.test.ts` - every block has moved; what is left is imports, the `vi.mock` line and `beforeEach(resetSdk)`.

## Steps

1. Find each block in `host.test.ts` by its `describe` or `it` name; the line numbers here are at `b4f1a4b` and task 01 shifted them.
2. Cut each block with the block comment above it, unchanged, into its new file, in the order the blocks stand in `host.test.ts`.
3. Open each new file with its `vitest` import, `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)`, an import from `./support/host.js` of only the names its blocks read, the other imports its blocks read (types, `Status`, `fileSessions`, `memorySessions`, `node:` modules, `checker`, `PROTOCOL_VERSION`) with the same specifiers, and `beforeEach(resetSdk)`.
4. Drop from `host.test.ts` the imports none of its remaining blocks reads.
5. Before deleting `host.test.ts`, confirm `grep -cE "^\s*(it|test)\(" packages/sdk/test/host.test.ts` is 0 and nothing but imports and those two lines is left.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- `pnpm exec vitest list packages/sdk | wc -l` equals the count recorded before task 01 (1,316 at `b4f1a4b`), and `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals the list task 01 saved, sorted the same way.
- `pnpm exec vitest list packages/sdk/test/host-names.test.ts` lists 25 tests, `host-snapshots.test.ts` 25 and `host-github.test.ts` 16.
- `wc -l` of each new file, recorded in *Resume*, is under 800; `wc -l packages/sdk/test/host-*.test.ts packages/sdk/test/support/*.ts` shows every file of this plan under 800.

## Resume
