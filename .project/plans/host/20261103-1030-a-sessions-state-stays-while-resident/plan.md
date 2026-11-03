---
title: A session's state stays while it is resident
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://feb72387 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L19 - the residency limit, 10"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L84-L89 - a turn's start touches its session, and every change of a session's active turn reconciles"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L102-L116 - `touch`, which moves a session to the newest end of the recency, and skips a draft"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L118-L140 - the session a resource keeps resident, and the subscribers that hold it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L279-L299 - the resident count, drafts left out, and `_isReleaseRequired`: archived, or the count over the limit"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L301-L344 - `_doReconcile`: archived sessions first, then the residents oldest first, until the count is within the limit"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L346-L361 - `_tryRelease`: never a session with subscribers, an active turn, or a restore in flight"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSubscriptionService.ts#L42-L62 - a chat, a changeset and a chat's canvas resolve to their session"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1368-L1390 - a release lets the agent's chats go, then evicts the session's state"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L10381-L10419 - the release is the idle eviction, and the only caller of an agent's `releaseChat`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L11633-L11634 - a subscribe touches its session and reconciles"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L11752 - an unsubscribe reconciles"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1457-L1464 - an archive reconciles"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L6489-L6490 - a create touches and reconciles"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13950-L13951 - and so does a restore"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L966-L973 - a closed connection's subscriptions are let go at once"
  - "[code://packages/sdk/src/host.ts#L1280-L1312](../../../../packages/sdk/src/host.ts#L1280-L1312) - `statesUnwatched`, which lets a session's state go once nobody watches it"
  - "[code://packages/sdk/src/host/sleep.ts#L193-L228](../../../../packages/sdk/src/host/sleep.ts#L193-L228) - the sweep, which sleeps the oldest turn start over the limit among running sessions only"
  - "[code://packages/sdk/src/host/sleep.ts#L173](../../../../packages/sdk/src/host/sleep.ts#L173) - a sleep lets the state go with the agent"
  - "[code://packages/sdk/src/host/chatactions.ts#L62](../../../../packages/sdk/src/host/chatactions.ts#L62) - an archive sleeps the session"
  - ".project/plans/host/79-a-quiet-session-sleeps-and-wakes/plan.md - the sleep, its timeout and its count limit"
---

## Goal

The state ahpd holds of a session goes only as VS Code's residency lets a session go.
An archived session goes, and so does the least recent one while more are resident than the limit.
A session a client watches, or one with a turn running, stays.
A session asleep keeps its state while it is resident, so a client that comes back is replayed what it missed.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `statesUnwatched`, `turnedAt` and `sessionResidencyLimit` in `packages`, `docs` and `.project/plans`.
- VS Code at `a4e689ae`: every use of `_sessionResidency` in agentService.ts, and the residency's own file.
- VS Code at `a4e689ae`: every caller of `releaseChat`, and the Claude agent for an idle timer of its own.
- VS Code at `a4e689ae`: protocolServerHandler.ts for what a closed connection does with its subscriptions.

### What VS Code's residency does

- A session is resident while the host holds its state.
  The count leaves out a draft nobody has used.
- The recency moves a session to its newest end when it is created or restored, when a client subscribes, and when a turn starts.
- A reconcile runs at each of those, at an unsubscribe, at an archive, and at a turn's end.
  It goes through the archived sessions first, then the residents oldest first, until no more are resident than the limit.
- A release lets the agent's chats go and evicts the state together.
  It never takes a session with subscribers, an active turn, or a restore in flight.
- VS Code has no idle timer besides it: an agent's `releaseChat` is called only by the release.

### Runtime path

```
subscribe -> snapshotOf -> touch -> reconcile
unsubscribe, a closed connection, an archive, a turn's start or end -> reconcile
reconcile -> each archived resident, then the oldest residents over the limit -> release
release -> a running session sleeps, and the state goes with it
```

### Gaps

- `statesUnwatched` lets a not-running session's state go as soon as nobody watches it.
- A sleep for quiet lets the state go with the agent.
- The count limit counts running sessions only, and orders them by their last turn start.
- A subscribe moves no session's recency.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A session's state goes only when it is archived, or is the least recent while the count is over the limit, and never while it has subscribers or an active turn | [agentSessionResidency.ts#L292-L299](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L292-L299); [#L346-L361](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L346-L361) | 01 |
| A client can tell: one that comes back is replayed where VS Code's host holds the state, and handed a snapshot where ahpd let it go | the ledger's judgment of P1-025 | 01 |
| The limit is 10, and the count leaves out a draft | [agentSessionResidency.ts#L19](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L19); [#L279-L290](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L279-L290) | 01 |
| The recency is touched at a create, a restore, a subscribe and a turn's start | [agentService.ts#L11633-L11634](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L11633-L11634); [#L6489-L6490](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L6489-L6490); [#L13950-L13951](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13950-L13951); [agentSessionResidency.ts#L84-L89](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L84-L89) | 01 |
| A reconcile runs at an unsubscribe, a closed connection and an archive too | [agentService.ts#L11752](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L11752); [protocolServerHandler.ts#L966-L973](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L966-L973); [agentService.ts#L1457-L1464](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1457-L1464) | 01 |
| A release lets the agent go and evicts the state in one step, so ahpd's count sleep is the same release | [agentService.ts#L1368-L1390](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1368-L1390); [#L10381-L10419](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L10381-L10419) | 01 |
| A session's changesets and a chat's canvas keep it resident; its annotations do not | [agentSessionResidency.ts#L118-L140](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L118-L140); [agentHostSubscriptionService.ts#L42-L62](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSubscriptionService.ts#L42-L62) | 01 |
| The timeout sleep is ahpd's own, from plan 79, with no counterpart in VS Code; it lets the agent go and keeps the state | plan 79's rows; the searches above | 01 |
| `0` sets no count limit, as plan 79 decided | plan 79's row for `sessionResidencyLimit` | 01 |

## Proposed architecture

- **State flow** - one recency of resident sessions, touched as VS Code touches it.
  A reconcile lets go each archived resident, then the oldest residents over the limit.
  A running session goes by a sleep, and its state goes with it.
- **Layer responsibilities** - sdk host: `touch`, `reconcile` and `release` in the sleep area.
  `letStateGo` in the host, and a touch at each subscribe and each start.
- **Source-of-truth files** - [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The residency lets a session's state go](task-01-the-residency-lets-a-state-go.md) | todo | - |

## Risks and tradeoffs

- A session's state is held while it is resident, so the host holds up to ten sessions' turns in memory.
- `0` keeps every session resident, where VS Code's limit of `0` keeps none that nothing holds.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a session whose chat has no conversation yet, which counts as a draft and is never let go.

## Final verification checklist

- [ ] Each new case fails on `feb72387`'s sources and passes after the change.
- [ ] The touched files' test files pass, one file at a time.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
