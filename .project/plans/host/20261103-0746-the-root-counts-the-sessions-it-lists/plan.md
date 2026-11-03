---
title: The root counts the sessions it lists
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/state.ts#L39 - \"Number of active (non-disposed) sessions on the server\""
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/root-channel.md#L29 - \"count of non-disposed sessions. Lightweight badge counter.\""
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/commands.ts#L20-L33 - the session list a client keeps by `root/sessionAdded` and `root/sessionRemoved`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/notifications.ts#L12-L69 - a session is added when created and removed when disposed"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2366-L2377 - the reference host's count, read by its own lifetime tracker"
  - "[code://packages/sdk/src/host/catalogue.ts#L493-L517](../../../../packages/sdk/src/host/catalogue.ts#L493-L517) - `activeCount`, the sessions running a turn"
  - "[code://packages/sdk/src/host/catalogue.ts#L1460-L1500](../../../../packages/sdk/src/host/catalogue.ts#L1460-L1500) - `chatMoved`, which reads the count after every chat action"
  - "[code://packages/sdk/src/host/history.ts#L203-L213](../../../../packages/sdk/src/host/history.ts#L203-L213) - a listing landing, which moves the catalogue"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1499-L1503](../../../../packages/sdk/src/host/sessionmethods.ts#L1499-L1503) - a chat's close, which reads the count"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L47-L74](../../../../packages/sdk/test/host-catalogue.test.ts#L47-L74) - the count's case"
---

## Goal

The root's `activeSessions` is the number of sessions not disposed: every session the catalogue lists, running, asleep or found by a listing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "activeSessions" packages/sdk/src docs` - the count is the sessions running a turn.
- `rg -n "activeSessions" vscode-a4e689ae/*` on the copies - no VS Code client reads the root's count; the host's lifetime tracker does.

### Runtime path

```
a session made, slept, woken or disposed -> activeSessionsMoved -> root/activeSessionsChanged when the number moved
a listing lands -> history.ts refresh -> activeSessionsMoved
```

### Gaps

- The count is the sessions running a turn, where the protocol counts every session not disposed.

## Answers

| What | Source | Task |
| --- | --- | --- |
| No VS Code client reads the root's `activeSessions`: its window keeps its own sets, and its host's count drives its lifetime tracker, so the specification's text decides | [agentHostStateManager.ts#L2366-L2377](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2366-L2377) | 01 |
| The text: "Number of active (non-disposed) sessions on the server", and "count of non-disposed sessions" | [state.ts#L39](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/state.ts#L39); [root-channel.md#L29](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/root-channel.md#L29) | 01 |
| A session is "created" when `root/sessionAdded` says it and "disposed" when `root/sessionRemoved` does, and a client keeps the session list by those two, so the count is that list's length | [notifications.ts#L12-L69](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/notifications.ts#L12-L69); [commands.ts#L20-L33](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/commands.ts#L20-L33) | 01 |
| This host says `root/sessionAdded` for a session it makes and for a row a listing finds, and `root/sessionRemoved` for a disposal and a row a listing loses, so every row of its catalogue counts, asleep or not | [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) | 01 |

## Proposed architecture

- **State flow** - the count is the ids of the running sessions, the sleeping ones and the listed rows, together.
- **Layer responsibilities** - sdk: `activeCount`, and the listing that moves it.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The count is the catalogue's rows](task-01-the-count-is-the-catalogues-rows.md) | todo | - |

## Risks and tradeoffs

- A host whose backends list many transcripts says a large count, as its session list holds them all.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a session still being made is not in any client's list until `root/sessionAdded` says it.

## Final verification checklist

- [ ] The changed cases fail on `cde4dd6c` for the reasons they name, and pass after the change.
- [ ] The catalogue, presence, sleep and wakeup test files pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
