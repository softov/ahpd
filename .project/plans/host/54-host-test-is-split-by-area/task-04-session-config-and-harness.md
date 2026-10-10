---
title: Session config and what the harness offers are test files of their own
status: done
depends: [task-03-turn-and-input.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host.test.ts#L1846-L2162](../../../../packages/sdk/test/host.test.ts#L1846-L2162) - `choosing a model`"
  - "[code://packages/sdk/test/host.test.ts#L2577-L2789](../../../../packages/sdk/test/host.test.ts#L2577-L2789) - `a session's config across a restart`, with its own `beforeEach` and `afterEach`"
  - "[code://packages/sdk/test/host.test.ts#L1384-L1721](../../../../packages/sdk/test/host.test.ts#L1384-L1721) - `what the harness offers`"
  - "[code://packages/sdk/test/host.test.ts#L2270-L2360](../../../../packages/sdk/test/host.test.ts#L2270-L2360) - `what a slash offers`"
  - "[code://packages/sdk/test/host.test.ts#L2950-L2989](../../../../packages/sdk/test/host.test.ts#L2950-L2989) - `what goes after a slash`"
  - "[code://packages/sdk/test/host.test.ts#L3436-L3537](../../../../packages/sdk/test/host.test.ts#L3436-L3537) - `turning a customization on and off`"
  - "[code://packages/sdk/test/host.test.ts#L3539-L3611](../../../../packages/sdk/test/host.test.ts#L3539-L3611) - `a skill is not a prompt`"
---

## Objective

`host-sessionconfig.test.ts` holds a session's model and config, and `host-harness.test.ts` holds what the harness offers a session: its capabilities, slash commands, customizations and skills; every test moved unchanged.

## Files

- `CREATE: packages/sdk/test/host-sessionconfig.test.ts` - `choosing a model`, `a session's config across a restart`; 25 tests, about 545 lines.
- `CREATE: packages/sdk/test/host-harness.test.ts` - `what the harness offers`, `what a slash offers`, `what goes after a slash`, `turning a customization on and off`, `a skill is not a prompt`; 32 tests, about 665 lines.
- `UPDATE: packages/sdk/test/host.test.ts` - those blocks removed; 159 tests left.

## Steps

1. Find each block in `host.test.ts` by its `describe` or `it` name; the line numbers here are at `b4f1a4b` and task 01 shifted them.
2. Cut each block with the block comment above it, unchanged, into its new file, in the order the blocks stand in `host.test.ts`.
3. Open each new file with its `vitest` import, `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)`, an import from `./support/host.js` of only the names its blocks read, the other imports its blocks read (types, `Status`, `fileSessions`, `memorySessions`, `node:` modules, `checker`, `PROTOCOL_VERSION`) with the same specifiers, and `beforeEach(resetSdk)`.
4. Drop from `host.test.ts` the imports none of its remaining blocks reads.
5. The `beforeEach` and `afterEach` inside `a session's config across a restart` move inside it, as they are.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- `pnpm exec vitest list packages/sdk | wc -l` equals the count recorded before task 01 (1,316 at `b4f1a4b`), and `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals the list task 01 saved, sorted the same way.
- `pnpm exec vitest list packages/sdk/test/host-sessionconfig.test.ts` lists 25 tests, and `host-harness.test.ts` 32.
- `wc -l` of each new file, recorded in *Resume*, is under 800.

## Resume

- **Done:** implemented 2026-10-04. `host-sessionconfig.test.ts` is 546 lines and `host-harness.test.ts` is 658, both under 800. `host.test.ts` has 159 tests left. The `beforeEach` and `afterEach` inside `a session's config across a restart` moved inside it, unchanged.
- **Counts:** `vitest list` gives 25 for sessionconfig and 32 for harness, the numbers the plan predicted.
- **Gates:** `pnpm exec tsc --noEmit` and `pnpm boundary` pass. `pnpm exec vitest run packages/sdk` passes, 1,334 tests in 89 files. The sorted-name fingerprint is `532860aa4c087b69e30d8a47dcead5f4`, unchanged.
- **Next action:** [task-05-tools-and-terminals.md](task-05-tools-and-terminals.md).
- **Open questions:** none.
- **Watch out for:** a block's name is quoted in the source, so `a session's config across a restart` is written `a session\'s config across a restart` there. Address a block by the name vitest reports, with the quote unescaped.
