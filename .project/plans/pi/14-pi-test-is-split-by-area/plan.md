---
title: agent-pi.test.ts is split into one test file per area
domain: pi
status: built
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
refs:
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L1-L207](../../../../packages/agent-pi/test/agent-pi.test.ts#L1-L207) - the imports, the `beforeAll` that loads pi, the `root` hooks and the shared helpers `turn`, `streamed`, `fakePi`, `opened`, `settled`, `driveCall` and `callStatuses`"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L209-L2165](../../../../packages/agent-pi/test/agent-pi.test.ts#L209-L2165) - 126 `it` blocks (135 tests, one `it.each` of ten rows) in eleven areas, each opened by a `// <Area> ---` comment"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L1737-L1755](../../../../packages/agent-pi/test/agent-pi.test.ts#L1737-L1755) - `answer`, declared in the disk area and also called by the call timing area at line 2119"
  - "[code://packages/agent-pi/test/agent-pi-fork.test.ts#L21](../../../../packages/agent-pi/test/agent-pi-fork.test.ts#L21) - a comment that names `agent-pi.test.ts` as the home of the `forkAt` session cases, which move to the disk file"
  - "[code://packages/agent-pi/test/agent-pi-usage.test.ts#L20](../../../../packages/agent-pi/test/agent-pi-usage.test.ts#L20) - a comment that names `agent-pi.test.ts` as the home of the session cases, which stay"
  - "[code://packages/agent-pi/test/agent-pi-truncate.test.ts#L19](../../../../packages/agent-pi/test/agent-pi-truncate.test.ts#L19) - a comment that names `agent-pi.test.ts` as the home of the `rewindAt` cases, which stay"
  - "[code://packages/sdk/test/scenario.ts](../../../../packages/sdk/test/scenario.ts) - the one shared helper module in a test folder today: not a `*.test.ts`, so vitest does not collect it, and imported by the suites that use it"
  - "[code://vitest.config.ts](../../../../vitest.config.ts) - sets no `isolate` and no `include`, so every `*.test.ts` gets its own module graph and a helper's hooks register once per file that imports it"
  - "[code://tsconfig.json#L19](../../../../tsconfig.json#L19) - `packages/*/test/**/*.ts` is checked, so the helper module is type-checked like the suites"
---

## Goal

`packages/agent-pi/test/agent-pi.test.ts` is 2,165 lines, one flat file of 126 `it` blocks over eleven areas.
Softov set the bar on 2026-10-04: no file over 1,500 lines, and 1,000 is already too many.
After this plan the shared fake pi is a module of its own, each area is a test file of roughly 300 to 700 lines, and `agent-pi.test.ts` keeps the session cases.
It is a pure move: no test is rewritten, renamed, removed or added, and the same 151 tests run in `packages/agent-pi` before and after.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
Line numbers are at `b4f1a4b`.

### Searches performed

- `grep -nE "^// " packages/agent-pi/test/agent-pi.test.ts` - the area headers at 228 (Models), 286 (Host tools), 694 (Permission modes), 837 (Tools and the backend), 987 (Mapping), 1180 (The session), 1695 (The agent), 1735 (A session from disk), 1923 (The id a session is saved under), 2019 (When a call ran) and 2156 (The plugin); the schema case at 209 sits before the first header.
- `grep -nE "\bturn\(|\banswer\(|\bstreamed\(|\bfakePi\(|\bsessionOnDisk\(|\bending\(|\bverdict\(|\bcallStatuses\(" packages/agent-pi/test/agent-pi.test.ts` - which areas call which helper: `turn`, `streamed`, `fakePi`, `opened`, `settled` and `driveCall` are called from three or more areas; `answer` from the disk area and the call timing area; `callStatuses`, `verdict`, `noClient`, `callTool`, `ending`, `sessionOnDisk`, `CLIENT_ID`, `metaOf` and `timed` from one area each.
- `grep -n "\broot\b"` over each area - `root` is read by the tools, asking, session, agent, disk and id areas, and by `opened` and `sessionOnDisk`.
- `pnpm exec vitest list packages/agent-pi` - 151 tests: 135 in `agent-pi.test.ts` and 16 in the five sibling files; one name ("draws a live ls call by what it runs on, while it runs and once it is done") appears twice, from two `it.each` rows.
- `ls packages/agent-pi/test` - the existing files are `agent-pi-fork`, `agent-pi-lazy`, `agent-pi-options`, `agent-pi-truncate` and `agent-pi-usage`; no new name below collides with them.
- `rg -n "agent-pi.test.ts" .project packages` - built plans name the file as history; the open plans host/50 task 01 and container/05 p5 tasks 06 and 07 add session cases to it, which still belong in it after the split; `.project/plans/pi/00-pi.md` lists it under *Tests* with a path that does not resolve (`code://test/agent-pi.test.ts`).

### Runtime path

```
vitest collects packages/agent-pi/test/*.test.ts -> each file imports test/fake-pi.ts -> its beforeAll, beforeEach and afterEach register on that file -> opened() builds piSession over fakePi() in that file's root
```

### Gaps

- `root` is a module-level `let` set by a `beforeEach` and read by `opened` and by the cases, so the helper that holds `opened` has to own the hook and the binding together.
- `answer` is declared in the middle of the file and used by two areas, so it cannot stay with either.
- `pnpm exec vitest run packages/agent-pi` at `b4f1a4b` reported 1 failed of 151: the 2,000 ms import budget in `agent-pi-lazy.test.ts`, which this plan does not touch; the count check reads `vitest list`, which runs nothing.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| No file over 1,500 lines; 1,000 is already too many | Softov, 2026-10-04 | every task |
| Test files of roughly 300 to 800 lines, one per area, named `agent-pi-<area>.test.ts` without colliding with the existing five | the request, 2026-10-04 | 02, 03 |
| A pure move: no test is rewritten, renamed, removed or added; comments move with their code | the request, 2026-10-04 | every task |
| The same tests run before and after, checked by name, not only by count | the request, 2026-10-04 | every task |
| A helper used by two or more files moves to `test/fake-pi.ts`; a helper used by one file moves with that file's cases | (defaulted: a shared module holds only what is shared, the way `packages/sdk/test/scenario.ts` does) | 01, 02, 03 |
| The `beforeAll` that loads pi, the `root` binding and its `beforeEach` and `afterEach` move into `test/fake-pi.ts` unchanged, `root` as `export let root`, and run in every file that imports it | (defaulted: `opened` reads `root`, so passing it in would rewrite every call; vitest gives each test file its own module graph, [code://vitest.config.ts](../../../../vitest.config.ts)) | 01 |
| `agent-pi.test.ts` stays, holding the schema, models, session, agent and plugin cases | (defaulted: the sibling comments in `agent-pi-usage.test.ts` and `agent-pi-truncate.test.ts` and the open plans host/50 and container/05 p5 name it as the home of the session cases) | 04 |
| The comment in `agent-pi-fork.test.ts` that names where the `forkAt` cases are is pointed at `agent-pi-disk.test.ts` | [code://packages/agent-pi/test/agent-pi-fork.test.ts#L21](../../../../packages/agent-pi/test/agent-pi-fork.test.ts#L21) would name a file that no longer holds them | 03 |

## Proposed architecture

Every file below lives in `packages/agent-pi/test/`.
Each new file opens with the imports its moved code uses, from `./fake-pi.js` and the sources, and nothing else.
The moved lines are copied as they are; the only new lines are imports, `export` on the shared helpers and one comment at the top of `fake-pi.ts` saying it is not a test file.

| File | What it holds | Lines moved from `agent-pi.test.ts` at `b4f1a4b` | Tests | Estimated lines |
| --- | --- | --- | --- | --- |
| `fake-pi.ts` (not a test file) | the `beforeAll` that loads pi, `root` and its hooks, `turn`, `streamed`, `fakePi`, `opened`, `settled`, `driveCall`, `answer` | 31-179, 1737-1755 | 0 | ~195 |
| `agent-pi.test.ts` (kept) | the suite comment, the schema case, Models, The session, The agent, The plugin | 22-29, 209-284, 1180-1733, 2156-2165 | 55 | ~665 |
| `agent-pi-tools.test.ts` | Host tools up to the instructions cases (`noClient`, `callTool`, conversion, client tools, `setTools`, instructions), and Tools and the backend (rebuilds, the tools and effects a running turn was built with, an aborted call, the client-owned mark) | 286-470, 837-985 | 21 | ~350 |
| `agent-pi-asking.test.ts` | `callStatuses`, the ask cases from "asks a person before a call runs" to the `projectTrust deny` case with the `it.each` of drawn calls, and Permission modes (`verdict` and its cases) | 181-207, 472-692, 694-835 | 28 | ~405 |
| `agent-pi-mapping.test.ts` | Mapping (`mapEvent`, `activityOf`, `resultText`) and When a call ran (`metaOf`, `timed` and the call timing cases, live and replayed) | 987-1178, 2019-2154 | 18 | ~340 |
| `agent-pi-disk.test.ts` | A session from disk (`sessionOnDisk` and its cases) and The id a session is saved under (`CLIENT_ID`, the id, fork and listing cases) | 1735-1736, 1757-2017 | 13 | ~275 |

55 + 21 + 28 + 18 + 13 = 135, the count `agent-pi.test.ts` runs today.

- **Data flow** - unchanged: every case still drives a `piSession` over the same `fakePi` through `opened`.
- **State flow** - `root` is created per case by the `beforeEach` in `fake-pi.ts` and read through the live `export let` binding; `forget()` still runs after each case.
- **Layer responsibilities** - agent-pi tests only; no source file changes.
- **Source-of-truth files** - [`code://packages/agent-pi/test/agent-pi.test.ts`](../../../../packages/agent-pi/test/agent-pi.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The fake pi is a module the suites share](task-01-the-fake-pi-is-a-shared-module.md) | done | - |
| [02 - The tool and asking cases are files of their own](task-02-tools-and-asking-are-files.md) | done | 01 |
| [03 - The mapping and disk cases are files of their own](task-03-mapping-and-disk-are-files.md) | done | 01 |
| [04 - agent-pi.test.ts holds the session cases, and the domain names every file](task-04-the-session-file-and-the-domain.md) | done | 02, 03 |

## Risks and tradeoffs

- Hooks registered by an imported module run once per importing file only because vitest isolates each test file; a config that turned `isolate` off would share one `root` across files, so the risk is named in `fake-pi.ts`'s top comment.
- A case that read `root` through a local copy would see a stale directory; none does, and every reader uses the imported binding.
- A case left behind or copied twice changes the count by one; the name list before and after is compared with `diff`, which also catches the duplicated `it.each` name.
- `agent-pi-lazy.test.ts` can time out under a loaded machine; it is not moved, and a failure there is not a failure of this plan if it also fails on `b4f1a4b`.
- Open plans that add session cases (host/50 task 01, container/05 p5 tasks 06 and 07) still find them in `agent-pi.test.ts`; one that adds a mapping, tool, ask or disk case finds the area's file by name.

## Resume state

- **Done so far:** all four tasks, merged in `de626be`. `agent-pi.test.ts` is 669 lines and holds the session, models, schema, agent and plugin cases. The tools, asking, mapping and disk areas are files of their own; `test/fake-pi.ts` is the fake they share; `00-pi.md` names them.
- **Next action:** none. Every task was reviewed against main on 2026-10-10 and is `done`; the work is in `de626be`.
- **Open questions:** none.
- **Watch out for:** the test name list is an md5, `fdec06ddb7fc9d771105d88551246ba7`, because this shell refuses to write a file from a command; the count is 157, not the plan's 151, since `agent-pi-delete.test.ts` arrived after `b4f1a4b`. `root` is `export let root`, never a reassigned copy.

## Final verification checklist

- [x] `wc -l packages/agent-pi/test/*.ts` shows no file over 800 lines and `agent-pi.test.ts` under 700. The largest is `agent-pi.test.ts` at 669.
- [x] `pnpm exec vitest list packages/agent-pi | sed 's/^[^>]*> //' | sort` matches the list taken at `b4f1a4b`, 151 lines. It is 157 today, since `agent-pi-delete.test.ts` added six after `b4f1a4b`, and the md5 of the sorted list is unchanged from before the first edit.
- [x] `git diff --stat` touches only `packages/agent-pi/test/` and `.project/plans/pi/00-pi.md`, plus this plan's own task files.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-pi` pass. The full `pnpm test` is 190 files and 2,839 tests, all passing.
- [x] `plans/index.md` updated.
