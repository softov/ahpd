---
title: The fake SDK and the shared helpers are modules of their own
status: todo
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host.test.ts#L24-L137](../../../../packages/sdk/test/host.test.ts#L24-L137) - the comment on the host without a socket, the `sdk` state in `vi.hoisted`, `sessionQueries` and the `vi.mock` factory"
  - "[code://packages/sdk/test/host.test.ts#L139-L209](../../../../packages/sdk/test/host.test.ts#L139-L209) - the modules loaded after the mock, `machine`, `serving`, `peer`, `open`, `hello`, and the top-level `beforeEach`"
  - "[code://packages/sdk/test/host.test.ts#L534-L579](../../../../packages/sdk/test/host.test.ts#L534-L579) - `running`, `actions`, `settle`, `emit`"
  - "[code://packages/sdk/test/scenario.ts](../../../../packages/sdk/test/scenario.ts) - a helper module beside the suites, the shape the two new modules copy"
---

## Objective

`packages/sdk/test/support/claude-sdk.ts` holds the fake Claude SDK and `packages/sdk/test/support/host.ts` holds the helpers several blocks call, and `host.test.ts` reads both through imports and one `vi.mock` line, with all 328 of its tests still in it and passing.

## Files

- `CREATE: packages/sdk/test/support/claude-sdk.ts` - `export const sdk` (the object `vi.hoisted` returns today, with its `Fake` interface and comments), `export const fake` (the object the `vi.mock` factory returns today), and `export function resetSdk()` (the body of the top-level `beforeEach`); it imports nothing.
- `CREATE: packages/sdk/test/support/host.ts` - the comment on the host without a socket, `sessionQueries`, the `await import` lines for `createHost`, `fileResources`, `list`, `read`, `resolve`, `complete`, `shellTerminals`, `gitBranches`, `claude`, `echo`, `hostTools` and `gitChanges` with each name re-exported, `machine`, `serving`, `peer`, `open`, `hello`, `running`, `actions`, `settle` and `emit`, each exported; `sdk` and `resetSdk` re-exported from `./claude-sdk.js`.
- `UPDATE: packages/sdk/test/host.test.ts:24-209` - the comment, `sdk`, `sessionQueries`, the mock, the `await import` lines, `machine`, `serving`, `peer`, `open`, `hello` and the `beforeEach` body removed; `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)`, an import of what the file reads from `./support/host.js`, and `beforeEach(resetSdk)` in their place. `REPO` (15-22) and `ETX` (156-157) stay.
- `UPDATE: packages/sdk/test/host.test.ts:534-579` - `running`, `actions`, `settle` and `emit` removed.

## Steps

1. Before any edit, run `pnpm exec vitest list packages/sdk > <scratch>/before.txt` outside the repository, and write `wc -l` of it (1,316 at `b4f1a4b`) into this task's *Resume* and the plan's *Resume state*.
2. Move each declaration with its comment, unchanged but for `export`, its indentation out of `vi.hoisted`, and relative paths one level deeper (`../src/` becomes `../../src/`, `../../agent-claude/` becomes `../../../agent-claude/`, `../../../examples/` becomes `../../../../examples/`).
3. The `await import` lines stay dynamic imports, in their order, so the modules they load are evaluated after the mock is registered exactly as today.
4. `support/claude-sdk.ts` imports neither `support/host.ts` nor anything that reaches `@anthropic-ai/claude-agent-sdk`, because the mock's factory loads it while that module is being mocked.
5. In `host.test.ts`, import from `./support/host.js` only the names the file still reads, and keep `vi` in its `vitest` import for the `vi.mock` line and `authenticating`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes, with no CLI started by any `host.test.ts` test (a missing mock shows as a hang or a spawn error).
- `pnpm exec vitest list packages/sdk | wc -l` equals the count from step 1, and `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals `sed 's/^[^ ]* > //' <scratch>/before.txt | sort`.
- `git diff -M --color-moved=zebra` shows the declarations as moved.

## Resume
