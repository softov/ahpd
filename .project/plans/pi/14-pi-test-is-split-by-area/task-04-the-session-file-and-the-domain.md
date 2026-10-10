---
title: agent-pi.test.ts holds the session cases, and the domain names every file
status: done
depends:
  - task-02-tools-and-asking-are-files.md
  - task-03-mapping-and-disk-are-files.md
layer: "agent-pi tests, docs"
refs:
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L209-L284](../../../../packages/agent-pi/test/agent-pi.test.ts#L209-L284) - the schema case and Models, 7 tests, which stay"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L1180-L1733](../../../../packages/agent-pi/test/agent-pi.test.ts#L1180-L1733) - The session and The agent, 46 tests, which stay"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L2156-L2165](../../../../packages/agent-pi/test/agent-pi.test.ts#L2156-L2165) - The plugin, 2 tests, which stay"
---

## Objective

`agent-pi.test.ts` is the suite comment, its imports and the schema, models, session, agent and plugin cases, 55 tests in about 665 lines, and `.project/plans/pi/00-pi.md` lists every test file under *Tests*.

## Files

- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - only if tasks 02 and 03 left an import nothing uses or a blank run between areas.
- `UPDATE: .project/plans/pi/00-pi.md` - the *Tests* line, today `code://test/agent-pi.test.ts`, which does not resolve.

## Steps

1. Read `agent-pi.test.ts` top to bottom: the suite comment (22-29 at `b4f1a4b`), the imports, the schema case, then the Models, The session, The agent and The plugin areas in today's order, and nothing else.
2. In `00-pi.md`, replace the *Tests* line with one line per file, each a `code://packages/agent-pi/test/<file>` link three `../` deep: `agent-pi.test.ts` (schema, models, the turn lifecycle, steering, the queue, titles, the agent), `agent-pi-tools.test.ts`, `agent-pi-asking.test.ts`, `agent-pi-mapping.test.ts`, `agent-pi-disk.test.ts`, and `fake-pi.ts` as the shared fake `PiBackend`.
3. Run `wc -l packages/agent-pi/test/*.ts` and record the counts in this task's *Resume*.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-pi` passes, 151 tests; a timeout in `agent-pi-lazy.test.ts` that also happens on `b4f1a4b` is not this task's.
- The test count is equal before and after: `pnpm exec vitest list packages/agent-pi | sed 's/^[^>]*> //' | sort` has 151 lines and `diff` against the list taken at `b4f1a4b` prints nothing.
- `wc -l packages/agent-pi/test/*.ts` shows no file over 800 lines.
- `git diff --stat b4f1a4b` touches only `packages/agent-pi/test/` and `.project/plans/pi/00-pi.md`.

## Resume

- `agent-pi.test.ts` needed no further edit: tasks 02 and 03 left no unused import and no run of blank lines, so it is the suite comment, its imports, the schema case, Models, The session, The agent and The plugin, 55 cases.
- `wc -l packages/agent-pi/test/*.ts`: `agent-pi.test.ts` 669, `agent-pi-asking.test.ts` 400, `agent-pi-tools.test.ts` 345, `agent-pi-mapping.test.ts` 334, `agent-pi-disk.test.ts` 272, `fake-pi.ts` 196, `agent-pi-usage.test.ts` 227, `agent-pi-fork.test.ts` 178, `agent-pi-truncate.test.ts` 152, `agent-pi-delete.test.ts` 129, `agent-pi-lazy.test.ts` 111, `agent-pi-options.test.ts` 63. Nothing over 700.
- `.project/plans/pi/00-pi.md` *Tests* is one line per file now, each a `code://packages/agent-pi/test/<file>` link three `../` deep. The old `code://test/agent-pi.test.ts`, which resolved to nothing, is gone; the six existing sibling files (`-fork`, `-truncate`, `-usage`, `-delete`, `-lazy`, `-options`) were not listed, because the task names only the six it wrote and they were not named before either.
- Gates: `pnpm exec tsc --noEmit` and `pnpm boundary` pass; the md5 of the test name list is still `fdec06ddb7fc9d771105d88551246ba7`; the full `pnpm test` is 190 files and 2,839 tests, all passing, `agent-pi-lazy.test.ts` included on an idle machine.
- Not done, by the request: `plans/index.md` is untouched, so the plan's last checklist box stays open.
