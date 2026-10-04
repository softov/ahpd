---
title: The tool and asking cases are files of their own
status: implemented
depends:
  - task-01-the-fake-pi-is-a-shared-module.md
layer: "agent-pi tests"
refs:
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L286-L470](../../../../packages/agent-pi/test/agent-pi.test.ts#L286-L470) - Host tools up to the instructions cases, with `noClient` and `callTool`, 14 tests"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L837-L985](../../../../packages/agent-pi/test/agent-pi.test.ts#L837-L985) - Tools and the backend, 7 tests"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L181-L207](../../../../packages/agent-pi/test/agent-pi.test.ts#L181-L207) - `callStatuses`, called only by the ask cases"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L472-L692](../../../../packages/agent-pi/test/agent-pi.test.ts#L472-L692) - the ask cases, from \"asks a person before a call runs\" to the `projectTrust deny` case, with one `it.each` of ten rows, 20 tests"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L694-L835](../../../../packages/agent-pi/test/agent-pi.test.ts#L694-L835) - Permission modes, `verdict` and its cases, 8 tests"
---

## Objective

The host tool and backend cases run from `agent-pi-tools.test.ts`, the ask and permission mode cases from `agent-pi-asking.test.ts`, and `agent-pi.test.ts` no longer holds them.

## Files

- `CREATE: packages/agent-pi/test/agent-pi-tools.test.ts` - lines 286-470 and 837-985, in that order; 21 tests, about 350 lines.
- `CREATE: packages/agent-pi/test/agent-pi-asking.test.ts` - lines 181-207, 472-692 and 694-835, in that order; 28 tests, about 405 lines.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - those ranges removed, and the imports nothing left uses.

## Steps

1. Create `agent-pi-tools.test.ts` with the `// Host tools ---` header and lines 287-470, then the `// Tools and the backend ---` header and lines 838-985, as they are.
2. Give it the imports that code uses: `expect` and `it` from `vitest`, `Status`, `Bag`, `BoundTool`, `Start`, `mapEvent`, `THINKING_KEY`, `piSession`, `OpenPi`, `BackendOptions` and `toPiTool` from their sources, and `root`, `turn`, `fakePi`, `opened`, `settled` and `driveCall` from `./fake-pi.js`.
3. Create `agent-pi-asking.test.ts` with `callStatuses` and its comment (181-207), the ask cases (472-692) and the `// Permission modes ---` header with lines 695-835, as they are.
4. Give it the imports that code uses: `mkdtempSync`, `rmSync` and `symlinkSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`, `expect` and `it` from `vitest`, `Status`, `Bag`, `BoundTool`, `Start` and `piAgent` from their sources, and `root`, `opened`, `settled` and `driveCall` from `./fake-pi.js`.
5. Remove the moved ranges from `agent-pi.test.ts` and drop the imports it no longer uses.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-pi` passes, 151 tests; a timeout in `agent-pi-lazy.test.ts` that also happens on `b4f1a4b` is not this task's.
- The test count is equal before and after: `pnpm exec vitest list packages/agent-pi | sed 's/^[^>]*> //' | sort` has 151 lines and `diff` against the list taken at `b4f1a4b` prints nothing.
- `pnpm exec vitest list packages/agent-pi/test/agent-pi-tools.test.ts` lists 21 tests and `agent-pi-asking.test.ts` 28.

## Resume

- `agent-pi-tools.test.ts` is 345 lines: the `// Host tools ---` area with `noClient` and `callTool`, then `// Tools and the backend ---`, 21 cases, and it imports `root`, `turn`, `fakePi`, `opened`, `settled` and `driveCall` from `./fake-pi.js`.
- `agent-pi-asking.test.ts` is 400 lines: `callStatuses` and its comment, the ask cases including the `it.each` of ten rows, then `// Permission modes ---` with `verdict`, 28 cases, importing `root`, `opened`, `settled` and `driveCall`.
- Both were written with the imports the moved code uses and nothing else; `mkdtempSync`, `symlinkSync`, `tmpdir`, `rmSync` and `BoundTool` left `agent-pi.test.ts` with them, and `callStatuses` left it too.
- `agent-pi.test.ts` is 1,263 lines and 55 cases less.
- Gates: `pnpm exec tsc --noEmit` and `pnpm boundary` pass; `vitest list` gives 21 and 28 for the two new files and the md5 of the whole list is still `fdec06ddb7fc9d771105d88551246ba7`; `vitest run packages/agent-pi` is 157 tests with only the `agent-pi-lazy.test.ts` budget failing.
