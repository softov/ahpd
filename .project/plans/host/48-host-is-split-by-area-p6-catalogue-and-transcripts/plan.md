---
title: The catalogue, past sessions and snapshots are files of their own
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p3-changesets-and-facts/plan.md
  - plans/host/48-host-is-split-by-area-p5-session-and-root-config/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L1040-L1130](../../../../packages/sdk/src/host.ts#L1040-L1130) - `startedBy`, `chatSummary`, `subagentSummary`, `restoredSubagentSummary`; `beside`, `madeFrom`, `described`, `subagents` and `links` between them stay"
  - "[code://packages/sdk/src/host.ts#L1433-L1505](../../../../packages/sdk/src/host.ts#L1433-L1505) - `statusOf`, `urgency`, `drivingOf`, `modifiedOf`, `activityOf`"
  - "[code://packages/sdk/src/host.ts#L2467-L2600](../../../../packages/sdk/src/host.ts#L2467-L2600) - `announced`, `activeSessionsMoved`, `changesOf`, `summaryOf`, `sessionAdded`, `summaryMoved`, `learnModels`"
  - "[code://packages/sdk/src/host.ts#L4177-L4396](../../../../packages/sdk/src/host.ts#L4177-L4396) - `listing`, `waitingFor`, `readStored`; `setTimeout(readStored)` at 4397 stays"
  - "[code://packages/sdk/src/host.ts#L490](../../../../packages/sdk/src/host.ts#L490) - `LISTING_FRESH`, read by `catalogue` only"
  - "[code://packages/sdk/src/host.ts#L6397-L6556](../../../../packages/sdk/src/host.ts#L6397-L6556) - `history`, `reading`, `subHistory`, `restoredSubagents`, `restoredParentChat`, `linkedTurns`, `titles`, `listed`, `pastAt`, `listNow`, `catalogue`, `past`"
  - "[code://packages/sdk/src/host.ts#L6557-L6931](../../../../packages/sdk/src/host.ts#L6557-L6931) - `value` and `snapshotOf`"
---

## Goal

The session list and each row of it, a session read back from its transcript, and the snapshot a subscribe answers are three files.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `statusOf` is called from the returned `Host.turning` and from the dispatch branches, so `host.ts` destructures it.
- `listed` and `pastAt` are `let`s written only by `listNow` and `catalogue`, so they move with them.
- `snapshotOf` reads almost every area: routing, changesets, facts, root, session config, history, terminals and automations; it is built last of the three and takes later ones as functions that call them.
- Open plans that cite the code this child moves: host/30 (`summaryOf`, `listing`), host/44 (`summaryOf`), host/44 p3 (`chatSummary`, `subagentSummary`, `summaryOf`, `summaryMoved`, the session state's `chats` in `snapshotOf`), host/43 p2 (the session state spread in `snapshotOf`), host/31 (a browsed row in `listing`), claude/09 (`learnModels` reads `about`, which stays).

### Gaps

- `readStored` is scheduled at construction (`:4397`); that statement stays in `host.ts` and calls it through the factory.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every factory takes the `HostContext`, and adds its area's fields to `host/context.ts` | the parent's second table, Softov's "One HostContext" | 01, 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The catalogue and its rows are one file](task-01-catalogue.md) | done | - |
| [02 - Past sessions and snapshots are their own files](task-02-history-and-snapshots.md) | done | 01 |

## Resume state

- **Done so far:** built 2026-10-04, see [implemented.md](implemented.md).

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/sessions.test.ts`, `test/subscribe.test.ts`, `test/subagent-chat.test.ts`, `test/session-provider.test.ts`, `test/presence.test.ts` and `test/conformance.test.ts` cover this area.
- [x] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, about 1,070 lines fewer than before.
- [x] `plans/index.md` updated.
