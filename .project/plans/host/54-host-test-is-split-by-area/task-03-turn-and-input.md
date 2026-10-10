---
title: A turn and what a client puts into it are test files of their own
status: done
depends: [task-02-handshake-and-catalogue.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host.test.ts#L581-L1050](../../../../packages/sdk/test/host.test.ts#L581-L1050) - `driving a turn` from its opening to `says a turn ended badly even when the harness gave no words`, with `what kind of row a tool call is`; reads `checker`"
  - "[code://packages/sdk/test/host.test.ts#L1052-L1343](../../../../packages/sdk/test/host.test.ts#L1052-L1343) - `driving a turn` from `blocks on a confirmation and runs the tool when it is approved` to `settles the blocked promise when the turn is cancelled`, with `an approval that can be kept`"
  - "[code://packages/sdk/test/host.test.ts#L1345-L1381](../../../../packages/sdk/test/host.test.ts#L1345-L1381) - `tells every client when a session goes`, `moves serverSeq with state, so a snapshot has a place in the stream`, and the block's closing line"
  - "[code://packages/sdk/test/host.test.ts#L2362-L2386](../../../../packages/sdk/test/host.test.ts#L2362-L2386) - `what the client is told about its own turn`"
  - "[code://packages/sdk/test/host.test.ts#L2812-L2948](../../../../packages/sdk/test/host.test.ts#L2812-L2948) - `one tool call, one row`"
  - "[code://packages/sdk/test/host.test.ts#L3963-L3988](../../../../packages/sdk/test/host.test.ts#L3963-L3988) - `a compacted context`"
  - "[code://packages/sdk/test/host.test.ts#L4752-L4797](../../../../packages/sdk/test/host.test.ts#L4752-L4797) - `running a failed turn again`"
  - "[code://packages/sdk/test/host.test.ts#L3074-L3216](../../../../packages/sdk/test/host.test.ts#L3074-L3216) - `a message typed while a turn is running`"
  - "[code://packages/sdk/test/host.test.ts#L5752-L5796](../../../../packages/sdk/test/host.test.ts#L5752-L5796) - `what a chat says about itself`, interactivity and the steering message"
---

## Objective

`host-turn.test.ts` holds a turn from the client's message to its end, and `host-input.test.ts` holds what a client puts into a running turn: confirmations, kept approvals, answers, queued and steering messages; every test moved unchanged and under its own full name.

## Files

- `CREATE: packages/sdk/test/host-turn.test.ts` - `describe('driving a turn', ...)` holding 582-1050 and 1345-1380, then `what the client is told about its own turn`, `one tool call, one row`, `a compacted context`, `running a failed turn again`; 26 tests, about 760 lines.
- `CREATE: packages/sdk/test/host-input.test.ts` - `describe('driving a turn', ...)` holding 1052-1343, then `a message typed while a turn is running`, `what a chat says about itself`; 20 tests, about 500 lines.
- `UPDATE: packages/sdk/test/host.test.ts` - those blocks removed; 216 tests left.

## Steps

1. Find each block in `host.test.ts` by its `describe` or `it` name; the line numbers here are at `b4f1a4b` and task 01 shifted them.
2. Cut each block with the block comment above it, unchanged, into its new file, in the order the blocks stand in `host.test.ts`.
3. Open each new file with its `vitest` import, `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)`, an import from `./support/host.js` of only the names its blocks read, the other imports its blocks read (types, `Status`, `fileSessions`, `memorySessions`, `node:` modules, `checker`, `PROTOCOL_VERSION`) with the same specifiers, and `beforeEach(resetSdk)`.
4. Drop from `host.test.ts` the imports none of its remaining blocks reads.
5. `driving a turn` is the one block that is split: each new file opens its own `describe('driving a turn', () => {` and closes it with `});`, the opening line and the closing line being the only lines written twice; inside each, the tests stand in their original order, so `host-turn.test.ts` has 582-1050 followed by 1345-1380.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- `pnpm exec vitest list packages/sdk | wc -l` equals the count recorded before task 01 (1,316 at `b4f1a4b`), and `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals the list task 01 saved, sorted the same way.
- `pnpm exec vitest list packages/sdk/test/host-turn.test.ts` lists 26 tests, and `host-input.test.ts` 20, each name still starting `driving a turn >` where it did.
- `wc -l` of each new file, recorded in *Resume*, is under 800.

## Resume

- **Done:** implemented 2026-10-04. `host-turn.test.ts` is 756 lines and `host-input.test.ts` is 494, both under 800. `host.test.ts` is 5,248 lines with 216 tests left. `driving a turn` opened in both files and each test kept its full name: 25 of the 46 tests across the two files still read `driving a turn > ...`.
- **Counts:** `vitest list` gives 26 for turn and 20 for input, the numbers the plan predicted; 216 remain in `host.test.ts`.
- **Gates:** `pnpm exec tsc --noEmit` and `pnpm boundary` pass. `pnpm exec vitest run packages/sdk` passes, 1,334 tests in 87 files. The sorted-name fingerprint is `532860aa4c087b69e30d8a47dcead5f4`, unchanged.
- **Next action:** [task-04-session-config-and-harness.md](task-04-session-config-and-harness.md).
- **Open questions:** none.
- **Watch out for:** the mover at `.split54.mjs` copies a block's text without it passing through the caller's context, which is why it moves whole describes safely. Its `refresh` step rewrites the header of every file in `.split54.state.json` and nothing else; `host-close.test.ts` matches `host-*.test.ts` but is not this plan's, and it was restored from `a93988a` after a first run of the script rewrote its header by mistake.
