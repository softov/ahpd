---
title: The mapping and disk cases are files of their own
status: done
depends:
  - task-01-the-fake-pi-is-a-shared-module.md
layer: "agent-pi tests"
refs:
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L987-L1178](../../../../packages/agent-pi/test/agent-pi.test.ts#L987-L1178) - Mapping, 12 tests"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L2019-L2154](../../../../packages/agent-pi/test/agent-pi.test.ts#L2019-L2154) - When a call ran, with `metaOf` and `timed`, 6 tests"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L1735-L1922](../../../../packages/agent-pi/test/agent-pi.test.ts#L1735-L1922) - A session from disk, with `sessionOnDisk`, 4 tests; `answer` (1737-1755) left in task 01"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L1923-L2017](../../../../packages/agent-pi/test/agent-pi.test.ts#L1923-L2017) - The id a session is saved under, with `CLIENT_ID`, 9 tests"
  - "[code://packages/agent-pi/test/agent-pi-fork.test.ts#L21](../../../../packages/agent-pi/test/agent-pi-fork.test.ts#L21) - the comment that names where the session-level `forkAt` cases are"
---

## Objective

The event mapping and call timing cases run from `agent-pi-mapping.test.ts`, the session-from-disk and saved-id cases from `agent-pi-disk.test.ts`, and `agent-pi.test.ts` no longer holds them.

## Files

- `CREATE: packages/agent-pi/test/agent-pi-mapping.test.ts` - lines 987-1178 and 2019-2154, in that order; 18 tests, about 340 lines.
- `CREATE: packages/agent-pi/test/agent-pi-disk.test.ts` - lines 1735-1736 and 1757-2017; 13 tests, about 275 lines.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - those ranges removed, and the imports nothing left uses.
- `UPDATE: packages/agent-pi/test/agent-pi-fork.test.ts:21` - `agent-pi.test.ts` becomes `agent-pi-disk.test.ts` in the comment; nothing else in the file changes.

## Steps

1. Create `agent-pi-mapping.test.ts` with the `// Mapping ---` header and lines 988-1178, then the `// When a call ran ---` header and lines 2020-2154 (its block comment, `metaOf`, `timed` and the six cases), as they are.
2. Give it the imports that code uses: `expect`, `it` and `vi` from `vitest`, `AgentSessionEvent`, `Bag`, `Start`, `activityOf`, `mapEvent` and `resultText` from their sources, and `turn`, `streamed`, `opened`, `settled`, `driveCall` and `answer` from `./fake-pi.js`.
3. Create `agent-pi-disk.test.ts` with the `// A session from disk ---` header, `sessionOnDisk` and its comment and the four cases (1757-1921), then the `// The id a session is saved under ---` header, `CLIENT_ID` and the nine cases (1924-2017), as they are.
4. Give it the imports that code uses: `readFileSync` from `node:fs`, `basename` and `join` from `node:path`, `expect` and `it` from `vitest`, `Bag`, `Start`, `piAgent`, `loadPi`, `piSession` and `resumeOrCreate` from their sources, and `root`, `streamed`, `fakePi`, `opened`, `settled`, `driveCall` and `answer` from `./fake-pi.js`.
5. Remove the moved ranges from `agent-pi.test.ts` and drop the imports it no longer uses.
6. Change the file name in the comment at `agent-pi-fork.test.ts:21`; the comments in `agent-pi-usage.test.ts:20` and `agent-pi-truncate.test.ts:19` stay, because the session and `rewindAt` cases they point at stay in `agent-pi.test.ts`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-pi` passes, 151 tests; a timeout in `agent-pi-lazy.test.ts` that also happens on `b4f1a4b` is not this task's.
- The test count is equal before and after: `pnpm exec vitest list packages/agent-pi | sed 's/^[^>]*> //' | sort` has 151 lines and `diff` against the list taken at `b4f1a4b` prints nothing.
- `pnpm exec vitest list packages/agent-pi/test/agent-pi-mapping.test.ts` lists 18 tests and `agent-pi-disk.test.ts` 13.

## Resume

- `agent-pi-mapping.test.ts` is 334 lines: `// Mapping ---` (12 cases) then `// When a call ran ---` with its block comment, `metaOf`, `timed` and the six timing cases, 18 in all.
- `agent-pi-disk.test.ts` is 272 lines: `// A session from disk ---` with `sessionOnDisk` and the four cases, then `// The id a session is saved under ---` with `CLIENT_ID` and the nine, 13 in all. `answer` came from `./fake-pi.js` as task 01 left it.
- `agent-pi-fork.test.ts:21` now names `agent-pi-disk.test.ts`; the comments in `agent-pi-usage.test.ts` and `agent-pi-truncate.test.ts` were left as they are, because the cases they point at stayed in `agent-pi.test.ts`.
- `agent-pi.test.ts` is 669 lines. Its imports are now `join`, `expect`, `it`, `Status`, `Bag`, `Start`, `piAgent`, `idOf`, `modelFor`, `offered`, `THINKING_KEY`, `optionsOf`, `piSession`, `OpenPi` and six names from `./fake-pi.js`; `readFileSync`, `basename`, `vi`, `AgentSessionEvent`, `activityOf`, `mapEvent`, `resultText`, `loadPi`, `resumeOrCreate`, `BackendOptions`, `toPiTool`, `answer` and `turn` went with the areas that used them.
- Gates: `pnpm exec tsc --noEmit` and `pnpm boundary` pass; `vitest list` gives 18 and 13 for the two new files and the md5 of the whole list is still `fdec06ddb7fc9d771105d88551246ba7`; `vitest run packages/agent-pi` is 157 tests with only the `agent-pi-lazy.test.ts` budget failing.
