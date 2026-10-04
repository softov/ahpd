---
title: The sdk has one helper that builds and keeps a tool call's timing _meta
domain: plugin
status: planned
priority: medium
created: 2026-09-29
revalidated: 2026-10-03
requires:
  - plans/plugin/29-a-tool-call-says-when-it-ran/plan.md
decisions:
  - decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md
refs:
  - "[code://packages/sdk/src/host.ts#L2214-L2250](../../../../packages/sdk/src/host.ts#L2214-L2250) - `unstamped`, `withWorkerUri` and `stampedCalls`, the pattern for a `_meta` key kept across actions"
  - "[code://packages/sdk/src/paging.ts](../../../../packages/sdk/src/paging.ts) - a small sdk module a plugin imports, the shape the helper's module takes"
  - "[code://packages/sdk/src/index.ts#L76-L77](../../../../packages/sdk/src/index.ts#L76-L77) - where such a module is exported"
---

## Goal

A helper in the sdk builds `{ 'ahpd.startedAt', 'ahpd.endedAt', 'ahpd.durationMs' }` from a start and an end and merges it into a call's `_meta` beside the keys already there, so a plugin that resends `_meta` keeps both `toolKind` and the times.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin, as ahpd keys](../../../decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md) | Softov, 2026-10-03 |

| What | Source | Task |
| --- | --- | --- |
| The helper is `packages/sdk/src/timing.ts`, exported from the sdk's index: `callTimes(start, end?, durationMs?)`, `withCallTimes(meta, times)` and `startOf(meta)` | (defaulted: one module per concern, as `paging.ts` is) | 01 |
| A time is given as epoch milliseconds or an ISO string, and written as ISO | the decision: the keys carry ISO times | 01 |
| A `durationMs` the harness measured is kept; with none, it is the end minus the start | (defaulted: cofold's `tool.completed` measures its own, and the harness's number is the truer one) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The sdk has one helper that builds and keeps a tool call's timing _meta](task-01-stamp.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the `ahpd.` times and `toolKind` again.
