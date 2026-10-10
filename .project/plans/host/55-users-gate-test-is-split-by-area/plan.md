---
title: users-gate.test.ts is split into one test file per area, with its shared helpers in one module
domain: host
status: built
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
changes: []
creates: []
refs:
  - "[code://packages/sdk/test/users-gate.test.ts](../../../../packages/sdk/test/users-gate.test.ts) - 1,786 lines, 60 tests at the top level with no `describe`, and every helper at module level"
  - "[code://packages/sdk/test/users-gate.test.ts#L21-L143](../../../../packages/sdk/test/users-gate.test.ts#L21-L143) - the header comment, the scratch directory and its hooks, and the helpers every area reads: `RECORD`, `peer`, `watching`, `Bag`, `said`, `until`, `can`, `directory`, `people`, `host`, `hello`, `signIn`, `call`"
  - "[code://packages/sdk/test/users-gate.test.ts#L145-L295](../../../../packages/sdk/test/users-gate.test.ts#L145-L295) - `handlerKeys`, `SERVED` and the four tests that read the tables with no host, the classification test among them"
  - "[code://packages/sdk/test/users-gate.test.ts#L166-L189](../../../../packages/sdk/test/users-gate.test.ts#L166-L189) - `classifies every handler the host serves`, which reads `host.ts` and every file under `src/host/` through `REPO` (line 29), a path relative to the test file's own folder"
  - "[code://packages/sdk/test/users-gate.test.ts#L297-L699](../../../../packages/sdk/test/users-gate.test.ts#L297-L699) - the command half: `holding`, operations, sign-in, roles, the principal and the deployment token"
  - "[code://packages/sdk/test/users-gate.test.ts#L701-L990](../../../../packages/sdk/test/users-gate.test.ts#L701-L990) - the dispatch half and root config: `configChanged`, `values`, `terminalsOf`, `rootMeta`"
  - "[code://packages/sdk/test/users-gate.test.ts#L992-L1244](../../../../packages/sdk/test/users-gate.test.ts#L992-L1244) - sessions held under a provider's scheme: `withRole` (1024-1037), `onDisk` and `listingOne` (1122-1146)"
  - "[code://packages/sdk/test/users-gate.test.ts#L1246-L1701](../../../../packages/sdk/test/users-gate.test.ts#L1246-L1701) - names, spellings, relayed watches and client ids: `publishing` (1246-1255) and `answering` (1483-1493)"
  - "[code://packages/sdk/test/users-gate.test.ts#L1703-L1786](../../../../packages/sdk/test/users-gate.test.ts#L1703-L1786) - `computer:write` for a session's source and for an automation's owner"
  - "[code://packages/sdk/test/scenario.ts](../../../../packages/sdk/test/scenario.ts) - the pattern the helper module copies: a plain `.ts` beside the tests, with `export`s, that vitest does not collect because its name has no `.test.`"
  - "[code://vitest.config.ts](../../../../vitest.config.ts) - no `include` and no `isolate`, so the default pattern collects `*.test.ts` only and each test file gets its own module graph"
  - "[code://tsconfig.json#L19](../../../../tsconfig.json#L19) - `packages/*/test/**/*.ts` is checked, so the helper module is type-checked like the tests"
  - "[code://.project/plans/host/48-host-is-split-by-area/plan.md](../48-host-is-split-by-area/plan.md) - the split this plan copies: a move by area, names unchanged, a line count recorded"
---

## Goal

`packages/sdk/test/users-gate.test.ts` is 1,786 lines.
Softov, 2026-10-04: no file over 1,500 lines, and 1,000 is already too many; test files should be roughly 300 to 800 lines.
After this plan the gate's tests are five files, one per area, `packages/sdk/test/users-gate-<area>.test.ts`, and the helpers more than one of them reads are one module, `packages/sdk/test/users-gate-helpers.ts`.
It is a pure move: no test is rewritten, renamed, removed or added, and the same number of tests runs before and after.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
Line numbers are at `b4f1a4b`.

### Searches performed

- `grep -c "^it(" packages/sdk/test/users-gate.test.ts` - 60 tests, all at the top level; the file has no `describe`.
- `grep -nw "<helper>" packages/sdk/test/users-gate.test.ts` for every module-level helper - which areas read each one, mapped in *Proposed architecture*.
- `grep -n "REPO" packages/sdk/test/users-gate.test.ts` - `REPO` (line 29) is read only by `classifies every handler the host serves` (176, 178).
- `grep -nw "rootMeta" packages/sdk/test/users-gate.test.ts` - defined at 848 in the root config block, read only by the principal tests at 455-528.
- `grep -nw "people" packages/sdk/test/users-gate.test.ts` - the helper at 110 is read only by the usage test at 604; the test at 661 declares a local `people` of its own.
- `grep -nw "configChanged\|values\|terminalsOf" packages/sdk/test/users-gate.test.ts` - read only by the root config tests at 854-990.
- `ls packages/sdk/test` - `scenario.ts` is the one helper module beside the tests; `fixtures/` holds data only.
- `rg -l "users-gate" .project/plans` - host/30, host/31, host/45 task 04 and host/47 p3 task 01 are open and cite the file; host/30 and host/31 name tests by title, host/45 task 04 by line.

### Runtime path

```
vitest run packages/sdk -> users-gate-<area>.test.ts -> import users-gate-helpers.ts (registers the scratch directory's beforeEach and afterEach) -> host() -> createHost -> accept -> handle
```

### Gaps

- One file holds six areas, with the helpers of each area declared where its tests start, so `rootMeta` is used 400 lines before it is declared.
- `root` and `file` are module `let`s that a `beforeEach` assigns and most helpers read, so moving the helpers means moving the hooks with them.
- `holding` (303) and `withRole` (1025) are near copies; this plan moves both as they are.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| No file over 1,500 lines; 1,000 is already too many | Softov, 2026-10-04 | 01, 02, 03 |
| `users-gate.test.ts` becomes one test file per area, `packages/sdk/test/users-gate-<area>.test.ts`, of roughly 300 to 800 lines each, plus a shared helper module | Softov, 2026-10-04 | 01, 02, 03 |
| A pure move: no test is rewritten, renamed, removed or added, the same number of tests runs before and after, and comments move with their code with none added about the move | Softov, 2026-10-04 | 01, 02, 03 |
| A helper read by two or more of the new files goes to `users-gate-helpers.ts` with `export` added and its body unchanged; a helper one file reads moves into that file | (defaulted: one module for what is shared, and nothing shared that is not) | 01 |
| `root` and `file` are exported as `let` from the helper module and its `beforeEach` and `afterEach` stay at its top level, so every test body reads them unchanged | (defaulted: an ES module import is a live binding, and vitest gives each test file its own module graph, so each file that imports the module registers the hooks once) | 01 |
| The classification test moves with `REPO`, `handlerKeys` and `SERVED` into `users-gate-tables.test.ts` in the same folder, so `join(import.meta.dirname, '../../..')` is still the repository root | [code://packages/sdk/test/users-gate.test.ts#L29](../../../../packages/sdk/test/users-gate.test.ts#L29) | 01 |
| `users-gate-tables.test.ts` is about 165 lines, under the band: it is the four tests that read the tables without a host, and no other area shares their imports | (defaulted: the classification test is an area of its own) | 01 |
| `asks a session's grants for completions in a session` (1469-1481) moves to the sessions file, the one test taken out of its run of lines | (defaulted: it asks a session's grants, like the tests around it there) | 03 |
| `users-gate.test.ts` is deleted once it is empty | (defaulted: an empty file would be a test file with no tests) | 03 |
| Open plans that cite `users-gate.test.ts` are not edited by this plan | Softov, 2026-10-04: "Do not edit any code, plans/index.md or any other plan." | - |

## Proposed architecture

Five test files and one helper module beside them in `packages/sdk/test/`.
Line ranges are in today's `users-gate.test.ts`; each file opens with only the imports its moved lines name.

| File | What moves into it | Lines today | Tests | Lines after (about) | Task |
| --- | --- | --- | --- | --- | --- |
| `users-gate-helpers.ts` | the header comment "The one gate" (21-27), `RECORD` (30), `root`, `file` and their `beforeEach` and `afterEach` (32-39), `peer` (41), `watching` (43-51), `Bag` (53), `said` and `until` (55-68), `can` and `directory` (70-101), `host`, `hello`, `signIn`, `call` (122-143), `withRole` (1024-1037), `onDisk` and `listingOne` (1122-1146) | 136 | 0 | 160 | 01 |
| `users-gate-tables.test.ts` | `REPO` (29), `handlerKeys` and `SERVED` (145-164), and the four table tests (166-295): every handler classified, every client action classified, every grant an operation or a group, the role matrix | 151 | 4 | 165 | 01 |
| `users-gate-commands.test.ts` | `people` (103-120), `holding` and the command gate (297-699): operations, a scheme's record, no directory, signing in, a member, a connection that arrived as somebody, the principal block (432-529), a read-only role, scheme scoping, usage pools, the deployment token, roles read on every command, the credential given back; and `rootMeta` (841-852) | 433 | 17 | 450 | 02 |
| `users-gate-dispatch.test.ts` | the dispatch half (701-810): a stranger's dispatch, a channel the role does not cover, a dispatch classified by its action, no directory; and root config (812-839, 854-990): `configChanged`, `values`, `terminalsOf` and the six `defaultShell` tests | 276 | 10 | 290 | 02 |
| `users-gate-sessions.test.ts` | a session under its provider's scheme (992-1022), a session's write group, its changeset and `session:changes` (1039-1120), rows a backend keeps on disk, a channel nobody can place, a disposed session, one catalogue read, config for no session (1148-1244), completions (1469-1481), and `computer:write` for a session and an automation's owner (1703-1786) | 307 | 13 | 320 | 03 |
| `users-gate-names.test.ts` | `publishing` and the names block (1246-1467): spellings as a file or a watch, terminal grants, names of one kind, the handshake, resuming a client id, relayed watches, a session's marks; `answering` and the client id block (1483-1701): another person's client id, every family to its own channel, a provider's scheme, marks once listed, binding and removing an id | 441 | 16 | 455 | 03 |

Of today's 1,786 lines, the 20 import lines and the blank lines between blocks are what is not listed; the imports are written again per file.
The 60 tests are 4 + 17 + 10 + 13 + 16.

- **Data flow** - unchanged: each test builds its own host through `host()` and drives it through `call`, `hello` and `signIn`.
- **State flow** - the scratch directory is made before each test and removed after it by the hooks in `users-gate-helpers.ts`, once per test file that imports it.
- **Layer responsibilities** - sdk tests only; no source file changes.
- **Source-of-truth files** - [`code://packages/sdk/test/users-gate.test.ts`](../../../../packages/sdk/test/users-gate.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The shared helpers and the table tests are files of their own](task-01-the-helpers-and-the-table-tests.md) | done | - |
| [02 - The command gate and the dispatch gate are files of their own](task-02-the-command-and-dispatch-gates.md) | done | 01 |
| [03 - Sessions and names are files of their own, and users-gate.test.ts is gone](task-03-sessions-and-names.md) | done | 02 |

## Risks and tradeoffs

- A hook registered at the top level of an imported module relies on each test file having its own module graph; `vitest.config.ts` leaves `isolate` at its default, which is true, and a later `isolate: false` would register the hooks for the first file only - the helper module's hooks are where to look if a scratch directory goes missing.
- A move can drop a test silently; each task records the test count before it starts and checks it after, and `vitest list` on the `users-gate` files gives 60 throughout.
- `verbatimModuleSyntax` is on, so `Bag`, `Grant`, `Users` and the other types are imported with `import type`, and an import a file no longer uses is removed with the lines that used it.
- Open plans cite `users-gate.test.ts`: host/30 and host/31 by test title, which still finds each test, and host/45 task 04 and host/47 p3 task 01 by path and line; whoever runs those finds the tests by title in the new files.
- Tests now run in five files in parallel, so the shell terminals the dispatch, names and sessions tests open run at the same time; each host is its own and each test's scratch directory is its own, so nothing is shared.

## Resume state

- **Done so far:** all three tasks. `packages/sdk/test/users-gate.test.ts` is gone and its 60 tests are five files beside `users-gate-helpers.ts`: tables 160 lines and 4 tests, commands 450 and 17, dispatch 285 and 10, sessions 322 and 13, names 453 and 16, helpers 155. `tsc --noEmit`, `pnpm boundary` and `vitest run packages/sdk` pass; `vitest list packages/sdk/test/users-gate` is 60.
- **Next action:** none. Every task was reviewed against main on 2026-10-10 and is `done`; the work is in `0f14041`.
- **Open questions:** none.
- **Watch out for:** `Bag` is imported `import type` from the helper module, because `verbatimModuleSyntax` makes it a type, where the tasks list it among the values. The `vitest list packages/sdk` count reads 1380 before the first `pnpm` invocation of a worktree and 1351 after it, which is the workspace's `tools/ahp.strict.schema.json` being generated during prepare and is not this move: users-gate was 60 on both sides of it.

## Final verification checklist

- [x] `packages/sdk/test/users-gate.test.ts` no longer exists.
- [x] `wc -l packages/sdk/test/users-gate-*.ts` is under 800 for every file.
- [x] `pnpm exec vitest list packages/sdk/test/users-gate | wc -l` is 60, and the test count in `packages/sdk` equals the count recorded before task 01.
- [x] Every test title in the old file appears exactly once across the new files.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/sdk` pass.
- [x] `plans/index.md` updated.
