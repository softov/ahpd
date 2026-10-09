---
title: The sdk's tools live in one folder
domain: host
status: active
priority: medium
created: 2026-10-07
revalidated: 2026-10-07
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/tools/index.ts](../../../../packages/sdk/src/tools/index.ts) - `hostTools`, the tools the package gives every session"
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - the session tools, under VS Code's names"
  - "[code://packages/sdk/src/tools/artifacts.ts](../../../../packages/sdk/src/tools/artifacts.ts) - the artifact tools"
  - "[code://packages/sdk/src/tools/server.ts](../../../../packages/sdk/src/tools/server.ts) - the host's tools served as an MCP server"
  - "[code://packages/sdk/src/tools/clientcalls.ts](../../../../packages/sdk/src/tools/clientcalls.ts) - a call a client's tool runs"
  - "[code://packages/sdk/src/tools/mcpcontent.ts](../../../../packages/sdk/src/tools/mcpcontent.ts) - a client's answer as MCP content"
  - "[code://packages/sdk/src/index.ts#L41-L53](../../../../packages/sdk/src/index.ts#L41-L53) - the exports of the six files"
  - "[code://packages/sdk/src/host](../../../../packages/sdk/src/host) - the folder pattern this mirrors"
---

## Goal

The sdk's tool code is in `packages/sdk/src/tools/`, not in six files at the top of `src/`.
Nothing a package imports from `@ahpd/sdk` changes.

## Reconnaissance

### Searches performed

- 2026-10-07: `rg "(artifacttools|sessiontools|toolserver|tools|clientcalls|mcpcontent)\.js'" packages/sdk` finds 21 importers in the sdk's `src` and `test`.
- Outside the sdk, only `packages/agent-acp/test/agent-acp-usage.test.ts` imports one of the files by path. Two comments name `packages/sdk/src/clientcalls.ts`: `packages/agent-pi/src/session.ts` and `packages/agent-cofold/src/turnagent.ts`.
- `UPSTREAM.md`, `plans/host/00-host.md`, two accepted decisions and three open plans name the old paths.

### Runtime path

```
packages/sdk/src/tools/*.ts -> packages/sdk/src/index.ts -> @ahpd/sdk -> every backend
```

### Gaps

- `Not found: a tools folder - searched packages/sdk/src`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | none | - |

| What | Source | Task |
| --- | --- | --- |
| The sdk has a `tools` folder | Softov, 2026-10-07: "also sdk need a folder called tools" | 01 |
| Six files move: `tools.ts` to `tools/index.ts`, `sessiontools.ts` to `tools/session.ts`, `artifacttools.ts` to `tools/artifacts.ts`, `toolserver.ts` to `tools/server.ts`, and `clientcalls.ts` and `mcpcontent.ts` under their own names | Softov, 2026-10-07, asked "Which files move into packages/sdk/src/tools/?" and answered "Tools and client calls" | 01 |
| The test files keep their names and place | (defaulted: `packages/sdk/test` is flat) | 01 |

## Proposed architecture

- **Layer responsibilities** - sdk: the folder holds the tools a session's agent is given, the server that serves them, and a client tool's call and answer.
- **Source-of-truth files** - [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts), whose exports stay the same.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The six files move into tools](task-01-the-six-files-move-into-tools.md) | implemented | - |

## Risks and tradeoffs

- Open plans that name an old path would point at nothing. Task 01 moves their refs. Built plans and their `implemented.md` keep the old paths as history.

## Resume state

- **Done so far:** task 01, 2026-10-09. The six files are in `packages/sdk/src/tools/`. Every importer, comment and ref that named an old path is repointed. The gates pass. Nothing is committed: Softov reads the diff first. See [implemented.md](implemented.md).
- **Next action:** Softov reviews the diff; the plan closes when task 01 passes it.
- **Open questions:** none.
- **Watch out for:** the six files are renames, so their history follows them; do not put a file back at the top of `packages/sdk/src`.

## Final verification checklist

- [ ] No file named in the second table is left at the top of `packages/sdk/src`.
- [ ] `@ahpd/sdk` exports the same names.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass.
- [ ] `plans/index.md` updated.
