---
title: A client's start is said when it is handed on
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://3945964a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752 - `dispatchClientAction` applies a client's action and emits it with its origin at once"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815 - a client's start is handed to the turn service, which sends it to the agent after"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2302-L2305 - a send whose turn was cancelled meanwhile reaches no agent"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12476-L12480 - a client's action waits only behind that client's own earlier ones, for the host's own prerequisites"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535 - a stop is matched to the active turn before anything is stopped"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md - the server applies a client's turnStarted when it receives it and broadcasts it, before the agent's deltas"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/relayTransport.ts#L48-L55 - a relay forwards a client's messages to the host running the session"
  - "[code://packages/sdk/src/host.ts#L813-L851](../../../../packages/sdk/src/host.ts#L813-L851) - `owed`, which holds a client's start and queued message until the backend says them"
  - "[code://packages/sdk/src/host.ts#L1024-L1028](../../../../packages/sdk/src/host.ts#L1024-L1028) - a turn's end that says the owed start first"
  - "[code://packages/sdk/src/host/chatactions.ts#L1361-L1373](../../../../packages/sdk/src/host/chatactions.ts#L1361-L1373) - a stop that waits for an owed start, and `ahead`, which holds the chat behind it"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1315-L1481](../../../../packages/sdk/src/host/lifecycle.ts#L1315-L1481) - `beginOrRun`, whose own check and machine catch-up answer in a later tick"
  - "[code://packages/agent-claude/src/session/turns.ts#L282-L469](../../../../packages/agent-claude/src/session/turns.ts#L282-L469) - Claude's `beginTurn`, which says its start after the tools land and the model switches"
  - "[code://packages/agent-cofold/src/turns.ts#L573-L614](../../../../packages/agent-cofold/src/turns.ts#L573-L614) - cofold's `beginTurn`, which waits on the lookup a resumed conversation makes"
---

## Goal

A client's `chat/turnStarted` and `chat/pendingMessageSet` are said when the host hands them to the backend, with the client's origin.
A backend that says them in that tick answers the client, and one that relays them takes them; otherwise the host says them as sent.
A stop matches the turn it names at once, and a backend that has not begun that turn begins nothing of it.
The `owed` map, `owe`, `startOwed` and `ahead` go.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `owed`, `owe`, `startOwed`, `ahead` and `answering` in `packages/sdk/src`, and where each backend says a client's start.
- VS Code at `a4e689ae` and `37eba093`: `dispatchClientAction`, `handleTurnStarted`, the per-client dispatch queue and the stop's match.
- The spec's reconciliation guide and `ChatTurnStartedAction`, where `startedAt` and the message's `origin` are required.

### What a VS Code client sees that ahpd's hold changes

- The echo's timing: VS Code's host applies a client's start at once, after its own checks, and hands it to the agent after.
- ahpd held the start until the backend said it: after a policy check, a machine's catch-up, Claude's tools and model switch, cofold's lookup.
- Meanwhile other windows showed no turn, a stop waited, and a turn from another window could take the chat first.
- A refusal after the client applied its start: ahpd refused a start a backend refused late, so the client's turn vanished.
- VS Code refuses only before applying, from its own checks; after that a failure ends the turn in an error.
- The fields the backend fills: a VS Code client sends the required fields, so the echo shows it nothing new.
- The rule that fills a field a client left out stays, now applied by the host to its own echo as well.

### Gaps

- The echo, a stop's match and a turn from another window all wait on the backend.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A client's start and queued message are said when they are handed on | [agentHostStateManager.ts#L2745-L2752](https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752); the spec's reconciliation example | 01 |
| The host's own checks come first, and a refusal from them is a refusal | [agentService.ts#L12476-L12480](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12476-L12480) | 01 |
| Work a dispatch waits on runs as that dispatch again, so its echo needs no map | the `applying` pattern `applyNow` already uses | 01 |
| A backend's own start of a turn the chat holds is not said | a turn starts once, as a turn ends once | 01 |
| A stop of a turn the backend has not begun reaches the backend, which begins nothing of it | [agentSideEffects.ts#L2302-L2305](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2302-L2305) | 01 |
| Claude says a client's start before the tools land and the model switches | [agentSideEffects.ts#L1810-L1815](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815) | 01 |
| cofold's lookup stays first, as VS Code restores a session before it applies a client's action; the host says the start meanwhile | [agentService.ts#L12476-L12480](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12476-L12480) | 01 |
| A session in a machine has a stop of a turn it does not hold yet matched inside | [relayTransport.ts#L48-L55](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/relayTransport.ts#L48-L55) | 01 |
| The host's own echo fills a turn's start time and a message's origin a client left out | `ChatTurnStartedAction` at spec/v1.0.0; reconciliation.md L60 | 01 |

## Proposed architecture

- **Data flow** - `beginOrRun` hands a turn on as the client's dispatch, through `later`, and says it through `sayUnanswered` where nothing did.
- **State flow** - the chat holds a client's turn from the hand-over; a backend's own start of it is dropped.
- **Layer responsibilities** - sdk: the host's echo, the stop's match, and what goes. Claude: its start before preparing. cofold: a stop during its lookup.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The start is said at the hand-over](task-01-the-start-is-said-at-the-hand-over.md) | done | - |

## Risks and tradeoffs

- A turn the host said for a backend that says it later carries no `ahpd.sender` in its live start; the record keeps the sender.
- Steering sent while a Claude turn prepares waits as a turn of its own, as it did while the start was held.
- VS Code's agents take such steering into the turn once it runs.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a relaying backend, which takes the start and answers it from the host inside.

## Final verification checklist

- [x] Each new and changed case fails on `3945964a`'s sources and passes after the change.
- [x] The test files that hold the cases pass, one file at a time.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
