---
title: The shared helpers and the table tests are files of their own
status: implemented
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/users-gate.test.ts#L21-L143](../../../../packages/sdk/test/users-gate.test.ts#L21-L143) - the header comment, the scratch directory and its hooks, and the helpers that move to the shared module"
  - "[code://packages/sdk/test/users-gate.test.ts#L1024-L1037](../../../../packages/sdk/test/users-gate.test.ts#L1024-L1037) - `withRole`, read by the dispatch, sessions and names areas"
  - "[code://packages/sdk/test/users-gate.test.ts#L1122-L1146](../../../../packages/sdk/test/users-gate.test.ts#L1122-L1146) - `onDisk` and `listingOne`, read by the sessions and names areas"
  - "[code://packages/sdk/test/users-gate.test.ts#L145-L295](../../../../packages/sdk/test/users-gate.test.ts#L145-L295) - `handlerKeys`, `SERVED` and the four table tests"
  - "[code://packages/sdk/test/users-gate.test.ts#L29](../../../../packages/sdk/test/users-gate.test.ts#L29) - `REPO`, the repository root the classification test reads `host.ts` and `src/host/` from"
  - "[code://packages/sdk/test/scenario.ts](../../../../packages/sdk/test/scenario.ts) - the helper module beside the tests that this one copies"
---

## Objective

`packages/sdk/test/users-gate-helpers.ts` holds every helper more than one area reads, with the scratch directory's hooks, and `packages/sdk/test/users-gate-tables.test.ts` holds the four tests that read the gate's tables without a host.
`users-gate.test.ts` imports the helpers from the new module and keeps its other 56 tests, so the suite is green after this task alone.

## Files

- `CREATE: packages/sdk/test/users-gate-helpers.ts` - about 160 lines: lines 21-27, 30, 32-39, 41-51, 53, 55-68, 70-101, 122-143, 1024-1037 and 1122-1146 of today's file, in that order, each declaration with `export`.
- `CREATE: packages/sdk/test/users-gate-tables.test.ts` - about 165 lines: line 29 and lines 145-164 and 166-295, 4 tests.
- `UPDATE: packages/sdk/test/users-gate.test.ts` - the lines above leave it; it imports from `./users-gate-helpers.js` what its remaining lines read; about 1,500 lines after.

## Steps

1. Record the test count: `pnpm exec vitest list packages/sdk | wc -l` and `pnpm exec vitest list packages/sdk/test/users-gate | wc -l` (60).
2. Write `users-gate-helpers.ts`: the header comment "The one gate" (21-27); `RECORD` (30); `let root`, `let file`, the `beforeEach` and the `afterEach` (32-39), with `root` and `file` exported as `let`; `peer`, `watching`, `Bag`, `said`, `until` (41-68); the two doc comments, `can` and `directory` (70-101); `host`, `hello`, `signIn` and `call` (122-143); `withRole` with its doc comment (1024-1037); `onDisk` and `listingOne` with their doc comments (1122-1146).
3. Add `export` to each of those declarations and change nothing else in them; its imports are `mkdtempSync`, `rmSync`, `writeFileSync`, `tmpdir`, `join`, `afterEach`, `beforeEach`, `createHost`, `ROOT`, `fileResources`, `holds`, `echo`, and `import type` for `HostOptions`, `Peer`, `Grant` and `Users`.
4. Write `users-gate-tables.test.ts`: `REPO` (29), `handlerKeys` with its doc comment and `SERVED` (145-164), then the four tests in their order (166-295); it imports `readdirSync`, `readFileSync`, `join`, `IS_CLIENT_DISPATCHABLE`, `expect`, `it`, `GATE`, `GROUPS`, `OPERATIONS`, `groupOf`, `holds` and `import type { Grant }`, and nothing from the helper module.
5. Leave `people` (103-120) in `users-gate.test.ts`: only the usage test reads it, and task 02 moves it with that test.
6. Remove the moved lines from `users-gate.test.ts`, import what it still reads from `./users-gate-helpers.js`, and drop the imports it no longer uses.

## Validation

- `users-gate-tables.test.ts`: `classifies every handler the host serves`, `classifies every action a client is allowed to send`, `asks every method and action for an operation the table knows, or a group of one`, `answers every method and action for a role of whole groups as the verb it replaced`, unchanged.
- `classifies every handler the host serves` still finds 45 handlers, which shows `REPO` resolves from the new file.
- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- The test count in `packages/sdk` equals the count recorded in step 1, and `pnpm exec vitest list packages/sdk/test/users-gate | wc -l` is still 60.

## Resume

Done. `users-gate-helpers.ts` (155 lines) and `users-gate-tables.test.ts` (160 lines) are written, and `users-gate.test.ts` is 1,488 lines holding the other 56 tests. `Bag` is imported `import type` from the helper module, because `verbatimModuleSyntax` makes it a type; the plan lists it among the values.
`vitest list packages/sdk/test/users-gate` is 60, `vitest run packages/sdk` is green, `tsc --noEmit` and `pnpm boundary` pass.

Next: task 02, the command and dispatch gates.
