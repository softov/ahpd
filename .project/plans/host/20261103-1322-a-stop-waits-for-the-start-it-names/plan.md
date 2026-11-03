---
title: A stop waits for the start it names
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://c97d8459 - the commit of ahpd this plan was checked at
  - git://c97d8459 - the last commit that holds .project/problems/a-stop-sent-while-a-turn-starts-is-lost.md, which this plan covers
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTurnService.ts#L126-L172 - a client's start is applied to the state at once, and its send to the agent follows"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L472-L486 - a client's cancel, applied, records its turn as cancelled"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2241-L2244 - a send whose turn was cancelled meanwhile reaches no agent"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2286-L2289 - the same check after the attachments and contributions"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2302-L2305 - and the last check, right before the provider has the turn"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535 - a stop is matched against the active turn before anything is stopped"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L24 - a client holds its actions pending in the order it sent them"
  - "[code://packages/sdk/src/host/chatactions.ts#L1368-L1373](../../../../packages/sdk/src/host/chatactions.ts#L1368-L1373) - a stop that names no held running turn is said as sent"
  - "[code://packages/sdk/src/host/chatactions.ts#L683-L686](../../../../packages/sdk/src/host/chatactions.ts#L683-L686) - a client's start is owed, and its backend says it when it begins"
  - "[code://packages/sdk/src/host.ts#L1026-L1033](../../../../packages/sdk/src/host.ts#L1026-L1033) - an end of a turn whose start is owed says that start first"
  - "[code://packages/sdk/src/host.ts#L2160-L2184](../../../../packages/sdk/src/host.ts#L2160-L2184) - `applyNow`, which holds a connection's next dispatch behind an owed answer for at most `WAIT_LIMIT`"
  - "[code://packages/sdk/src/host/chatactions.ts#L566-L582](../../../../packages/sdk/src/host/chatactions.ts#L566-L582) - an action that waits for a wake is applied again once the wake is done, the pattern reused here"
---

## Goal

A stop that names a turn whose start its backend owes waits for that start.
Once the backend says the start, the stop is applied and stops that turn.
Once the start is refused, the stop is said as sent and stops nothing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `chat/turnCancelled`, `owe`, `owed` and `awaited` in `packages/sdk/src`.
- The backends' `begin` in `packages/agent-claude`, `packages/agent-pi`, `packages/agent-acp`, `packages/agent-cofold` and `examples`, for a start said after an await.
- VS Code at `a4e689ae`: `_cancelledTurnIds` in agentSideEffects.ts, and `handleTurnStarted` in agentHostTurnService.ts.

### What VS Code's host does

- A client's start is applied to the state at once, and the send to the agent runs after it.
- A cancel that comes while the send is being prepared is applied at once, since the turn is active.
- The send checks for the cancel three times, and a cancelled turn never reaches the provider.

### What ahpd does

- A client's start is owed, and its backend says it once it begins.
  It begins after a policy check, a machine's catch-up, or Claude's change of tools or of model.
- The connection that sent the start waits for its answer before its next dispatch, for at most `WAIT_LIMIT`.
- A stop that comes on another connection, or after `WAIT_LIMIT`, finds no held running turn and is said as sent.
- Its dispatch then finds the start owed, and says that start ahead of the stop.
- The backend is told nothing, says the same start again when it begins, and runs the turn to its end.

### Runtime path

```
chat/turnStarted -> owe -> beginTurn -> the backend's begin -> chat/turnStarted, later
chat/turnCancelled -> the held running turn is not the one it names -> said as sent
```

### Gaps

- A stop of a turn whose start is owed is lost, and the turn starts twice in every client's state.
- A client that reconnects holds its start pending, and its stop on the new connection is not held behind the start.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A stop of a turn whose start a backend owes waits for that start's answer | [agentSideEffects.ts#L472-L486](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L472-L486); [#L2302-L2305](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2302-L2305) | 01 |
| Once the start is said, the stop is applied again and stops that turn, as any stop of the held running turn does | [agentService.ts#L13530-L13535](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535) | 01 |
| Once the start is refused, the stop is said as sent and stops nothing | [agentService.ts#L13530-L13535](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535) | 01 |
| The stop's connection sends nothing more until the stop is answered | [reconciliation.md#L23-L24](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L24) | 01 |
| A stop still waiting after `WAIT_LIMIT` is refused with the wait's own sentence | (defaulted: the bound every other wait of a dispatch has) | 01 |
| The stop is applied once the start is answered, whether or not its connection is still open | (defaulted: the reference host applies a stop when it comes, and the stop is about the chat) | 01 |

## Proposed architecture

- **State flow** - the stop waits on the owed start's answer, then goes through the stop's own case again.
- **Layer responsibilities** - sdk host: `startOwed` in the host, which settles at the owed start's answer, and the wait in the stop's case.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A stop waits for an owed start](task-01-a-stop-waits-for-an-owed-start.md) | todo | - |

## Risks and tradeoffs

- A stop and the dispatches after it on its connection wait for the start, as long as the backend takes to begin.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a start the host says ahead of a turn's end, which answers the start and lets the stop go too.

## Final verification checklist

- [ ] Each new case fails on `c97d8459`'s sources and passes after the change.
- [ ] The touched files' test files pass, one file at a time.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
