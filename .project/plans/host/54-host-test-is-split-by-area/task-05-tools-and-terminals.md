---
title: Tools and terminals are test files of their own
status: done
depends: [task-04-session-config-and-harness.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host.test.ts#L4977-L5383](../../../../packages/sdk/test/host.test.ts#L4977-L5383) - `tools the host contributes`, with `the session tools`"
  - "[code://packages/sdk/test/host.test.ts#L5385-L5461](../../../../packages/sdk/test/host.test.ts#L5385-L5461) - `the MCP servers a session is offered`"
  - "[code://packages/sdk/test/host.test.ts#L5463-L5718](../../../../packages/sdk/test/host.test.ts#L5463-L5718) - `tools a client contributes`"
  - "[code://packages/sdk/test/host.test.ts#L156-L157](../../../../packages/sdk/test/host.test.ts#L156-L157) - `ETX`, read only by `interrupting a terminal`"
  - "[code://packages/sdk/test/host.test.ts#L3990-L4251](../../../../packages/sdk/test/host.test.ts#L3990-L4251) - `a command typed into the conversation` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L4253-L4459](../../../../packages/sdk/test/host.test.ts#L4253-L4459) - `a shell on this machine`"
  - "[code://packages/sdk/test/host.test.ts#L4461-L4516](../../../../packages/sdk/test/host.test.ts#L4461-L4516) - `a terminal a backend opens` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L6310-L6344](../../../../packages/sdk/test/host.test.ts#L6310-L6344) - `interrupting a terminal`"
---

## Objective

`host-tools.test.ts` holds the tools and MCP servers a session is offered, and `host-terminals.test.ts` holds the host's terminals and the commands typed into a conversation; every test moved unchanged.

## Files

- `CREATE: packages/sdk/test/host-tools.test.ts` - `tools the host contributes`, `the MCP servers a session is offered`, `tools a client contributes`; 26 tests, about 760 lines.
- `CREATE: packages/sdk/test/host-terminals.test.ts` - `ETX` with its comment, `a command typed into the conversation`, `a shell on this machine`, `a terminal a backend opens`, `interrupting a terminal`; 21 tests, about 580 lines.
- `UPDATE: packages/sdk/test/host.test.ts` - those blocks and `ETX` removed; 112 tests left.

## Steps

1. Find each block in `host.test.ts` by its `describe` or `it` name; the line numbers here are at `b4f1a4b` and task 01 shifted them.
2. Cut each block with the block comment above it, unchanged, into its new file, in the order the blocks stand in `host.test.ts`.
3. Open each new file with its `vitest` import, `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)`, an import from `./support/host.js` of only the names its blocks read, the other imports its blocks read (types, `Status`, `fileSessions`, `memorySessions`, `node:` modules, `checker`, `PROTOCOL_VERSION`) with the same specifiers, and `beforeEach(resetSdk)`.
4. Drop from `host.test.ts` the imports none of its remaining blocks reads.
5. `ETX` moves with its comment to the top of `host-terminals.test.ts`, after the imports, because no other file reads it.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- `pnpm exec vitest list packages/sdk | wc -l` equals the count recorded before task 01 (1,316 at `b4f1a4b`), and `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals the list task 01 saved, sorted the same way.
- `pnpm exec vitest list packages/sdk/test/host-tools.test.ts` lists 26 tests, and `host-terminals.test.ts` 21.
- `wc -l` of each new file, recorded in *Resume*, is under 800.

## Resume

- **Done:** implemented 2026-10-04. `host-tools.test.ts` is 753 lines and `host-terminals.test.ts` is 579, both under 800. `host.test.ts` has 112 tests left. `ETX` moved with its comment to the top of `host-terminals.test.ts`, after the imports, and `host.test.ts` no longer declares it.
- **Counts:** `vitest list` gives 26 for tools and 21 for terminals, the numbers the plan predicted.
- **Gates:** `pnpm exec tsc --noEmit` and `pnpm boundary` pass. `pnpm exec vitest run packages/sdk` passes, 1,334 tests in 91 files. The sorted-name fingerprint is `532860aa4c087b69e30d8a47dcead5f4`, unchanged.
- **Next action:** [task-06-files-and-chats.md](task-06-files-and-chats.md).
- **Open questions:** none.
- **Watch out for:** a constant whose only reader has moved on has to be pinned to its new file before the move, or the file it was in stops declaring it and nobody does. `.split54.mjs pin ETX <file>` does this; `REPO` needs the same in task 06.
