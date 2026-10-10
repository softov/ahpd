---
title: The fake pi is a module the suites share
status: done
depends: []
layer: "agent-pi tests"
refs:
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L31-L179](../../../../packages/agent-pi/test/agent-pi.test.ts#L31-L179) - the `beforeAll` that loads pi, `root` and its hooks, `turn`, `streamed`, `fakePi`, `opened`, `settled` and `driveCall`"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L1737-L1755](../../../../packages/agent-pi/test/agent-pi.test.ts#L1737-L1755) - `answer`, used by the disk area and the call timing area"
  - "[code://packages/sdk/test/scenario.ts#L1-L23](../../../../packages/sdk/test/scenario.ts#L1-L23) - how a shared test module says it is not a test file"
---

## Objective

`packages/agent-pi/test/fake-pi.ts` holds the fake pi and every helper two or more areas call, and `agent-pi.test.ts` imports them from it, still running its 135 tests.

## Files

- `CREATE: packages/agent-pi/test/fake-pi.ts` - lines 31-179 and 1737-1755 of `agent-pi.test.ts`, with the imports they use; about 195 lines.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts:1-20` - the imports of the moved code are replaced by one import from `./fake-pi.js`.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts:31-179` and `:1737-1755` - removed, now in `fake-pi.ts`.

## Steps

1. Before any edit, on `b4f1a4b`, run `pnpm exec vitest list packages/agent-pi | sed 's/^[^>]*> //' | sort` into a file outside the repository; it has 151 lines.
2. Create `fake-pi.ts` with a top comment that says what it holds, that it is not a test file, and that its hooks run in each file that imports it because vitest isolates each file.
3. Move lines 31-179 into it as they are: the `beforeAll` with its comment, `root` as `export let root: string;`, the `beforeEach` and `afterEach`, and `turn`, `streamed`, `fakePi`, `opened`, `settled` and `driveCall` with their comments, each with `export` added.
4. Move `answer` (1737-1755) after them, with its comment and `export` added.
5. Give `fake-pi.ts` the imports that code uses: `mkdtempSync` and `rmSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`, `afterEach`, `beforeAll` and `beforeEach` from `vitest`, `AgentSessionEvent`, `Bag`, `Start`, `forget`, `PiModel`, `modelFor`, `THINKING_KEY`, `loadPi`, `piSession`, `OpenPi`, `BackendOptions`, `PiBackend`, `PiOptions` and `PiTurn`, from the same paths `agent-pi.test.ts` uses.
6. In `agent-pi.test.ts`, import the moved names from `./fake-pi.js` and drop the imports nothing left in the file uses; `callStatuses` (181-207) stays where it is until task 02.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-pi` passes, 151 tests; a timeout in `agent-pi-lazy.test.ts` that also happens on `b4f1a4b` is not this task's.
- The test count is equal before and after: `pnpm exec vitest list packages/agent-pi | sed 's/^[^>]*> //' | sort` has 151 lines and `diff` against the list taken at `b4f1a4b` prints nothing.

## Resume

- `packages/agent-pi/test/fake-pi.ts` is 196 lines and holds the `beforeAll` that loads pi, `export let root: string;` with its `beforeEach` and `afterEach`, `turn`, `streamed`, `fakePi`, `opened`, `settled`, `driveCall` and `answer`. Its top comment says what it holds, that it is not a test file, and that the hooks register per importing file because vitest isolates each one.
- `agent-pi.test.ts` is 1,993 lines and imports the nine moved names from `./fake-pi.js`; `callStatuses` stayed in it until task 02, as the plan says.
- Imports dropped from `agent-pi.test.ts` because nothing left uses them: `afterEach`, `beforeAll` and `beforeEach`, `forget`, `PiModel`, `PiBackend`, `PiOptions` and `PiTurn`. `modelFor` stays, because the Models area calls it too; `BackendOptions` stays for the two cases that build their own `OpenPi`.
- Gates: `pnpm exec tsc --noEmit` and `pnpm boundary` pass; `pnpm exec vitest run packages/agent-pi` is 135 tests in `agent-pi.test.ts` and 157 over the folder, with only `agent-pi-lazy.test.ts`'s 2,000 ms import budget failing, which fails on `b4f1a4b` too.
- The name list check is an md5 of `pnpm exec vitest list packages/agent-pi | sed 's/^[^>]*> //' | sort`, because this shell denies writing a file from a command: `fdec06ddb7fc9d771105d88551246ba7` before the first edit and after this one. The plan's 151 is the count at `b4f1a4b`; `agent-pi-delete.test.ts` has since added six.
- Not known to the plan: that the folder now holds six sibling files rather than five, and that 157 tests, not 151, is the number to keep.
