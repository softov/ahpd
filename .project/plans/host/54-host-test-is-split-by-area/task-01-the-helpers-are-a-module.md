---
title: The fake SDK and the shared helpers are modules of their own
status: done
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

- **Done:** implemented 2026-10-04 at `a93988a`. `support/claude-sdk.ts` (128 lines) holds `sdk`, `fake` and `resetSdk`; `support/host.ts` (115 lines) holds the comment, `sessionQueries`, the re-exported dynamic imports, `machine`, `serving`, `peer`, `open`, `hello`, `running`, `actions`, `settle`, `emit`, and re-exports `sdk` and `resetSdk`. `host.test.ts` is 7,721 lines, still 328 tests, and calls `beforeEach(resetSdk)` plus the one `vi.mock` line.
- **Count before:** 1,334 tests in `packages/sdk` across 83 files, measured at `a93988a` on 2026-10-04; 328 of them in `host.test.ts`. Not the plan's 1,316, which was measured at `b4f1a4b`. The name list fingerprint, `vitest list packages/sdk | sed 's/^[^ ]* > //' | sort | md5sum`, is `532860aa4c087b69e30d8a47dcead5f4`, and `host.test.ts`'s alone is `2ca2a42fc5da83e6872f5b74e5072be2`; both are unchanged after the move. Saving the list to a scratch file was not possible here, so the check is the fingerprint.
- **Gates:** `pnpm exec tsc --noEmit` and `pnpm boundary` pass; `pnpm exec vitest run packages/sdk` passes, 1,334 tests in 83 files. `tools/ahp.strict.schema.json` is generated by `node tools/schema.mjs`; `pnpm test` does it, so a bare `vitest run` fails 4 tests in `host.test.ts` with ENOENT until the schema is there.
- **Next action:** [task-02-handshake-and-catalogue.md](task-02-handshake-and-catalogue.md).
- **Open questions:** none.
- **Watch out for:** `vi` is still imported in `host.test.ts` for the `vi.mock` line and `authenticating`. `Fake` is exported from `support/claude-sdk.ts` because `sessionQueries` names it and a non-exported type cannot be named across the boundary.
