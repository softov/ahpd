---
title: A session reads as running while any of its chats runs, a worker chat included
domain: host
status: active
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L1177-L1197](../../../../packages/sdk/src/host.ts#L1177-L1197) - `statusOf`: activity from the lead chat, `InputNeeded` and `Error` promoted from other held chats, worker chats not read"
  - "[code://packages/sdk/src/host.ts#L2987-L2998](../../../../packages/sdk/src/host.ts#L2987-L2998) - `sendSubagent`, which re-announces the worker row and never calls `summaryMoved`"
  - "[code://packages/sdk/src/host.ts#L2080](../../../../packages/sdk/src/host.ts#L2080) - `summaryMoved`, which re-sends the session summary"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `SessionSummary`'s aggregation across chats: activity from the default chat, `InputNeeded` and `Error` promoted
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1970-L2006 - `_aggregateChatSummaries`: `InputNeeded` > `Error` > `InProgress` promoted from any chat, and the activity follows the chat that decided the status
---

## Goal

A session whose lead chat is idle while a fork, a side chat or a subagent is running reads as running in the session list, and as waiting when any of them waits on a person.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Reported on 2026-09-28 from another session: a session with a running fork or subagent reads idle.
- The protocol text promotes only `InputNeeded` and `Error`; the reference host also promotes `InProgress`, with `InputNeeded` > `Error` > `InProgress`.

### Runtime path

```
worker chat action -> sendSubagent -> chatUpdated (row) -> [new] summaryMoved(session)
statusOf(session) -> lead activity, [new] promoted by any held chat or worker chat
```

### Gaps

- `InProgress` in a non-lead chat is not promoted.
- Worker chats are not read by `statusOf`.
- A worker's change never re-sends the session summary.
- The `activity` string always follows the lead chat.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Status is the lead chat's activity, promoted by any chat (held or worker) with `InputNeeded` > `Error` > `InProgress`, as the reference host does. | the reference's `_aggregateChatSummaries`; upstream parity | 01 |
| The session's `activity` follows the chat that decided the status. | the protocol's aggregation note and the reference | 01 |
| A worker chat's status or activity change re-sends the session summary. | Softov's report: `sendSubagent` never calls `summaryMoved` | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The session's status and activity follow its busiest chat](task-01-status-follows-the-busiest-chat.md) | implemented | - |

## Risks and tradeoffs

- A background worker that runs after its lead turn keeps the session `InProgress` until it ends, which is what it is doing.

## Resume state

- **Done so far:** task 01 implemented, awaiting review.
- **Next action:** review task 01; the checklist's ahpapp check is not yet run.
- **Open questions:** none.
- **Watch out for:** `InputNeeded` is `24`, a superset of `InProgress`'s bit `8`, so a chat is purely in progress only when its status masked with `InputNeeded` equals `InProgress`.

## Final verification checklist

- [ ] In ahpapp, a session whose subagent runs after the lead turn ends shows as running until the subagent ends.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
