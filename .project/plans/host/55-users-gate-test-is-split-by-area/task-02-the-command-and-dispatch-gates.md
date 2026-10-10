---
title: The command gate and the dispatch gate are files of their own
status: done
depends: [task-01-the-helpers-and-the-table-tests.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/users-gate.test.ts#L103-L120](../../../../packages/sdk/test/users-gate.test.ts#L103-L120) - `people`, read only by the usage pools test"
  - "[code://packages/sdk/test/users-gate.test.ts#L297-L699](../../../../packages/sdk/test/users-gate.test.ts#L297-L699) - `holding` and the 17 command gate tests, the principal block among them"
  - "[code://packages/sdk/test/users-gate.test.ts#L841-L852](../../../../packages/sdk/test/users-gate.test.ts#L841-L852) - `rootMeta`, declared in the root config block and read only by the principal tests"
  - "[code://packages/sdk/test/users-gate.test.ts#L701-L839](../../../../packages/sdk/test/users-gate.test.ts#L701-L839) - the dispatch half's comment and four tests, the root config comment, `configChanged`, `values` and `terminalsOf`"
  - "[code://packages/sdk/test/users-gate.test.ts#L854-L990](../../../../packages/sdk/test/users-gate.test.ts#L854-L990) - the six `defaultShell` tests"
---

## Objective

`packages/sdk/test/users-gate-commands.test.ts` holds the 17 tests of the gate every command passes, and `packages/sdk/test/users-gate-dispatch.test.ts` holds the 4 dispatch gate tests and the 6 root config tests.
Line numbers below are today's; after task 01 find each block by its test title or helper name.

## Files

- `CREATE: packages/sdk/test/users-gate-commands.test.ts` - about 450 lines: `people` (103-120), `holding` and the command gate (297-699), `rootMeta` (841-852), 17 tests.
- `CREATE: packages/sdk/test/users-gate-dispatch.test.ts` - about 290 lines: the dispatch half (701-810), the root config comment and helpers (812-839), the root config tests (854-990), 10 tests.
- `UPDATE: packages/sdk/test/users-gate.test.ts` - the lines above leave it; about 760 lines after.

## Steps

1. Record the test count as in task 01, step 1.
2. Write `users-gate-commands.test.ts`: `people` with its doc comment (103-120), then 297-699 in order (the `holding` doc comment and helper, `asks one operation where the table gives one, and both where it gives both` through `takes the capability away the moment the credential is given back`, the principal comment at 432-442 included), then `rootMeta` with its doc comment (841-852) at the end, where it is still declared before any test runs.
3. Its imports are what those lines name: `writeFileSync`, `join`, `expect`, `it`, `createHost`, `ROOT`, `uriOf`, `fileUsers`, `memoryAutomations`, `fileUsage`, `usageProvider`, `echo`, `import type` for `ResourceProvider`, `Grant` and `Users`, and from `./users-gate-helpers.js` `RECORD`, `root`, `file`, `peer`, `watching`, `Bag`, `can`, `directory`, `host`, `hello`, `signIn` and `call`.
4. Write `users-gate-dispatch.test.ts`: 701-810 (the comment "The other half of the gate" and `refuses a dispatch from a connection that never signed in, and root state still names the terminal` through `dispatches freely with no user directory`), then 812-839 (the root record comment, `configChanged`, `values`, `terminalsOf`), then 854-990 (`keeps defaultShell to the connection that pushed it, and shares the rest` through `keeps a shell to its connection with no user directory either`).
5. Its imports are `expect`, `it`, `createHost`, `GATE`, `ROOT`, `shellTerminals`, `import type { Grant }`, and from `./users-gate-helpers.js` `root`, `peer`, `watching`, `Bag`, `until`, `directory`, `host`, `hello`, `signIn`, `call` and `withRole`.
6. Remove the moved lines from `users-gate.test.ts` and drop the imports it no longer uses.

## Validation

- `users-gate-commands.test.ts` holds 17 tests and `users-gate-dispatch.test.ts` holds 10, each title unchanged.
- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- The test count in `packages/sdk` equals the count recorded in step 1, and `pnpm exec vitest list packages/sdk/test/users-gate | wc -l` is still 60.

## Resume

Done. `users-gate-commands.test.ts` is 450 lines with 17 tests and `users-gate-dispatch.test.ts` is 285 lines with 10 tests, both with the imports this task's steps list them to have. `users-gate.test.ts` is 775 lines holding the 29 sessions and names tests. `Bag` is imported `import type` from the helper module, because `verbatimModuleSyntax` makes it a type.
`vitest list packages/sdk/test/users-gate` is 60, `vitest run packages/sdk` is green, `tsc --noEmit` and `pnpm boundary` pass.

Next: task 03, the sessions and names files, and deleting `users-gate.test.ts`.
