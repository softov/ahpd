---
title: The handshake and the catalogue are test files of their own
status: implemented
depends: [task-01-the-helpers-are-a-module.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host.test.ts#L211-L295](../../../../packages/sdk/test/host.test.ts#L211-L295) - `the handshake`"
  - "[code://packages/sdk/test/host.test.ts#L428-L531](../../../../packages/sdk/test/host.test.ts#L428-L531) - `what it will not pretend`, the methods and actions the host refuses"
  - "[code://packages/sdk/test/host.test.ts#L3613-L3724](../../../../packages/sdk/test/host.test.ts#L3613-L3724) - `a client that dropped, coming back`"
  - "[code://packages/sdk/test/host.test.ts#L4518-L4750](../../../../packages/sdk/test/host.test.ts#L4518-L4750) - `authenticating` and its comment; reads `vi`"
  - "[code://packages/sdk/test/host.test.ts#L5720-L5750](../../../../packages/sdk/test/host.test.ts#L5720-L5750) - `telling a client how far along something is`, progress against a request's token"
  - "[code://packages/sdk/test/host.test.ts#L7306-L7351](../../../../packages/sdk/test/host.test.ts#L7306-L7351) - `a client this host has not met` and its comment"
  - "[code://packages/sdk/test/host.test.ts#L297-L426](../../../../packages/sdk/test/host.test.ts#L297-L426) - `the catalogue`"
  - "[code://packages/sdk/test/host.test.ts#L1724-L1844](../../../../packages/sdk/test/host.test.ts#L1724-L1844) - `a session that already happened`"
  - "[code://packages/sdk/test/host.test.ts#L2165-L2268](../../../../packages/sdk/test/host.test.ts#L2165-L2268) - `paging a long history`"
  - "[code://packages/sdk/test/host.test.ts#L2388-L2427](../../../../packages/sdk/test/host.test.ts#L2388-L2427) - `the flags a client sets`"
  - "[code://packages/sdk/test/host.test.ts#L2429-L2575](../../../../packages/sdk/test/host.test.ts#L2429-L2575) - `a session read from its transcript`"
  - "[code://packages/sdk/test/host.test.ts#L2791-L2810](../../../../packages/sdk/test/host.test.ts#L2791-L2810) - `one conversation, one row`"
  - "[code://packages/sdk/test/host.test.ts#L6630-L6653](../../../../packages/sdk/test/host.test.ts#L6630-L6653) - the top-level `it` `takes a client into a session it is serving from a transcript`"
  - "[code://packages/sdk/test/host.test.ts#L7353-L7379](../../../../packages/sdk/test/host.test.ts#L7353-L7379) - the top-level `it` `takes a client into a session the catalogue has listed, before anybody reads it`"
---

## Objective

`host-handshake.test.ts` holds what a connection is told before and around its work, and `host-catalogue.test.ts` holds the session list and the sessions that already happened, with every test moved unchanged.

## Files

- `CREATE: packages/sdk/test/host-handshake.test.ts` - `the handshake`, `what it will not pretend`, `a client that dropped, coming back`, `authenticating`, `telling a client how far along something is`, `a client this host has not met`; 36 tests, about 630 lines.
- `CREATE: packages/sdk/test/host-catalogue.test.ts` - `the catalogue`, `a session that already happened`, `paging a long history`, `the flags a client sets`, `a session read from its transcript`, `one conversation, one row`, and the two top-level `it`s; 30 tests, about 635 lines.
- `UPDATE: packages/sdk/test/host.test.ts` - those blocks removed; 262 tests left.

## Steps

1. Find each block in `host.test.ts` by its `describe` or `it` name; the line numbers here are at `b4f1a4b` and task 01 shifted them.
2. Cut each block with the block comment above it, unchanged, into its new file, in the order the blocks stand in `host.test.ts`.
3. Open each new file with its `vitest` import, `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)`, an import from `./support/host.js` of only the names its blocks read, the other imports its blocks read (types, `Status`, `fileSessions`, `memorySessions`, `node:` modules, `checker`, `PROTOCOL_VERSION`) with the same specifiers, and `beforeEach(resetSdk)`.
4. Drop from `host.test.ts` the imports none of its remaining blocks reads.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- `pnpm exec vitest list packages/sdk | wc -l` equals the count recorded before task 01 (1,316 at `b4f1a4b`), and `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals the list task 01 saved, sorted the same way.
- `pnpm exec vitest list packages/sdk/test/host-handshake.test.ts` lists 36 tests, and `host-catalogue.test.ts` 30.
- `wc -l` of each new file, recorded in *Resume*, is under 800.

## Resume

- **Done:** implemented 2026-10-04. `host-handshake.test.ts` is 627 lines, `host-catalogue.test.ts` is 630, both under 800. `host.test.ts` is 6,478 lines with 262 tests left. Blocks kept their order and their names.
- **Counts:** `vitest list` gives 36 for handshake and 30 for catalogue, the numbers the plan predicted; 262 remain in `host.test.ts`.
- **Gates:** `pnpm exec tsc --noEmit` and `pnpm boundary` pass. `pnpm exec vitest run packages/sdk` passes, 1,334 tests in 85 files. The sorted-name fingerprint is `532860aa4c087b69e30d8a47dcead5f4`, unchanged.
- **Note:** a first run of `packages/sdk` after this task reported 1 failure of 1,334. It did not reproduce, and the run that showed it took 67s against 28s for the clean one, so it was flake under load rather than a defect; `host-handshake.test.ts` and `host-catalogue.test.ts` pass on their own.
- **Next action:** [task-03-turn-and-input.md](task-03-turn-and-input.md).
- **Open questions:** none.
- **Watch out for:** blocks are cut by a scratch script at `.split54.mjs`, which the import header of each file is generated from. A name in a comment is not a use of it, so the generator strips comments before it decides what to import; check an import by hand if a file's header looks thin.
