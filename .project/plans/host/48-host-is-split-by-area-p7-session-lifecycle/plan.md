---
title: Starting, restarting and removing a session are files of their own
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p6-catalogue-and-transcripts/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L1124-L1144](../../../../packages/sdk/src/host.ts#L1124-L1144) - `absorb`, a worker chat's action folded into the state a subscriber reads"
  - "[code://packages/sdk/src/host.ts#L2214-L2268](../../../../packages/sdk/src/host.ts#L2214-L2268) - `unstamped`, `withWorkerUri`, `stampedCalls`, `withSender`, which plugin/29 p1 extends first"
  - "[code://packages/sdk/src/host.ts#L3519-L3687](../../../../packages/sdk/src/host.ts#L3519-L3687) - `describedSub`, `endedWorkers`, `sendSubagent`, `openSubagent`, `formerChatUri`, `titleOf`, `keepTitle`, `keepProvider`"
  - "[code://packages/sdk/src/host.ts#L3688-L4099](../../../../packages/sdk/src/host.ts#L3688-L4099) - `spawn`, about 410 lines, the one place a backend's session is started"
  - "[code://packages/sdk/src/host.ts#L5100-L5554](../../../../packages/sdk/src/host.ts#L5100-L5554) - `removeSession`, `restart`, `moveSession`, `restartChat`, `HOSTS_OWN`, `backendsOwn`, `isolated`"
  - "[code://packages/sdk/src/host.ts#L5620-L5723](../../../../packages/sdk/src/host.ts#L5620-L5723) - `beginOrRun`, `beginTurn`"
  - "[code://packages/sdk/src/host.ts#L6932-L6990](../../../../packages/sdk/src/host.ts#L6932-L6990) - `modelIn`, `messageFrom`, `messageAttachments`"
  - "[code://packages/sdk/src/host.ts#L7078-L7167](../../../../packages/sdk/src/host.ts#L7078-L7167) - `openSession`"
---

## Goal

How a backend's session is started with its workers, and how a session is opened, moved, restarted, removed and handed a message, are two files.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `spawn` reads the most of any function: routing, telemetry, owners, machines, session config, root, catalogue, tooling (p8), the meter, `nestedAgent`, `computersFor`, and the shared maps, all off `ctx`.
- `restarting`, `lives`, `decided` and `worktrees` are written by lifecycle and by the dispatch branches or the `vscode/*` methods, `offered` by lifecycle, `settle` and `listing`, `moving` by `spawn` and `toolContext`; all stay shared in `host.ts`.
- Open plans that cite the code this child moves: host/30 (`spawn`, `removeSession`, `withWorkerUri`), host/31 (`spawn`'s config), host/43 p4 (`sender` in `spawn` and `withSender`), host/44 p3 (`openSubagent`, `spawn`'s `session/chatUpdated`, `removeSession`), claude/09 (`beginOrRun`, `messageFrom`, `spawn`'s customizations), container/04, container/05 p9 and p10 (`nestedAgent` in `spawn`, `removeSession`, `restartChat`), container/05 p7 and p12 (`isolated`, `removeSession`), plugin/29 and its p1 (`unstamped`, `withWorkerUri`, `stampedCalls`).

### Gaps

- `tooling` moves in p8 and `spawn` calls `toolDefinitions` and `boundTools`; `spawn` reads them as `ctx.toolDefinitions` and `ctx.boundTools` when called.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every factory takes the `HostContext`, and adds its area's fields to `host/context.ts` | the parent's second table, Softov's "One HostContext" | 01, 02 |
| The call stamps plugin/29 adds beside `stampedCalls` move with it | the request, 2026-10-03: plugin/29 merges first | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Starting a backend's session and its workers is one file](task-01-spawn.md) | todo | - |
| [02 - Opening, moving, restarting and removing a session is one file](task-02-lifecycle.md) | todo | 01 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-spawn.md](task-01-spawn.md).
- **Open questions:** none of its own.
- **Watch out for:** `spawn` writes `names`, `births`, `served`, `moving` and `drafts`, which `listing`, `toolsServersGone`, `toolContext` and `removeSession` also write; every one stays a shared map on the context.

## Final verification checklist

- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/host.test.ts`, `test/sessions.test.ts`, `test/subagent-chat.test.ts`, `test/nested-*.test.ts`, `test/turning.test.ts`, `test/worktrees.test.ts` and the backend packages' tests cover this area.
- [ ] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, about 1,350 lines fewer than before.
- [ ] `plans/index.md` updated.
