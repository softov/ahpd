---
title: A stop of no running turn is echoed
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
changes:
  - specs/sessions-and-chats.md
refs:
  - git://6e6d1ca8 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535 - a `chat/turnCancelled` whose `turnId` is not the chat's active turn is applied and echoed as the client's action, \"Ignoring cancellation of an inactive turn\", and nothing is aborted"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12552-L12562 - a chat action on a session the host has not loaded restores the session before the action is read"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L186-L188 - the chat reducer ends a turn only when the id the action names is the active turn's"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L353 - the specification's text: a stop with no active turn, \"Server MUST reject the action\""
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSteeringMessageHandoff.ts#L62-L65 - VS Code's steering handoff reads no rejected action, and clears on an accepted cancel at L121-L125"
  - "[code://packages/sdk/src/host/chatactions.ts#L464-L476](../../../../packages/sdk/src/host/chatactions.ts#L464-L476) - a stop on a session asleep in the catalogue, refused before a wake"
  - "[code://packages/sdk/src/host/chatactions.ts#L1236-L1296](../../../../packages/sdk/src/host/chatactions.ts#L1236-L1296) - a stop refused with no turn running, echoed when it names another turn on a lead chat, and a worker chat's stop"
  - "[code://.project/plans/host/20261101-0331-a-cancel-with-no-turn-running-is-refused/plan.md](../20261101-0331-a-cancel-with-no-turn-running-is-refused/plan.md) - the answers this plan reverses in part: the refusals go, and the stop that stops nothing stays"
  - "[code://.project/specs/sessions-and-chats.md#L86-L113](../../../specs/sessions-and-chats.md#L86-L113) - a stop with no turn running, and a stop in a worker chat"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L515-L519](../../../../packages/sdk/test/ahp-test-cases.test.ts#L515-L519) - the oracle's row that allows the refusal"
---

## Goal

A client's stop of a chat that runs no turn is accepted and stops nothing, as VS Code's host takes it.
So is a stop that names a turn the chat is not running.
It goes to every client of the chat as the client's own action, and the chat's reducer leaves the chat as it was.
A stop of the running turn stops it, as now.
Nothing is woken or asked of a backend for a stop that stops nothing, a sleeping session's included.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "Nothing is running on" packages/*/src` - three refusals of a stop: a session asleep, a chat with no running turn, and a worker chat whose lead runs nothing.
- `rg -n "Nothing is running on" packages/*/test` - `host-catalogue`, `session-wake`, `subagent-chat` and the oracle's refusal row hold them.
- VS Code main at `37eba093` matches a stop to the chat's active turn before it reduces it.
- So a stale stop cannot abort the chat there.
- The same host restores a session it has not loaded before it reads the chat, and a stop then finds no active turn.

### Runtime path

```
client chat/turnCancelled -> chatAction
  a session asleep in the catalogue -> echo, nothing woken
  a chat with no running turn, or a stop naming another turn -> echo, nothing stopped
  a lead chat's running turn -> stopped, and the backend told
  a worker chat's running turn -> stopWorker, or the lead turn
```

### Gaps

- A stop with no turn running is refused, and so is one on a worker chat whose worker has ended.
- VS Code's host accepts and echoes both, so a VS Code client's steering handoff keeps waiting where VS Code's host lets it go.
- A stop on a worker chat that names another turn than the worker's stops the worker.
- VS Code's host matches every stop to its chat's active turn.
- The specification's text has the server reject a stop with no active turn; VS Code's host decides here.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A stop on a chat that runs no turn is accepted, goes to every client of the chat as the client's own action, and stops nothing | [agentService.ts#L13530-L13535](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535) | 01 |
| A stop naming another turn than the chat's running one is answered the same way, on a worker's chat too | [agentService.ts#L13530-L13535](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535); [reducer.ts#L186-L188](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L186-L188) | 01 |
| A stop on a session asleep in the catalogue is answered the same way, and the session is not woken | [code://packages/sdk/src/host/chatactions.ts#L464-L476](../../../../packages/sdk/src/host/chatactions.ts#L464-L476) | 01 |
| A worker chat whose worker has ended stops nothing of its lead | [code://.project/specs/sessions-and-chats.md#L102-L113](../../../specs/sessions-and-chats.md#L102-L113) | 01 |
| A stop naming no turn names the running one, and the backend is handed that turn's id, as now | [code://packages/sdk/src/host/chatactions.ts#L1263-L1275](../../../../packages/sdk/src/host/chatactions.ts#L1263-L1275) | 01 |
| The oracle allows no refusal of a stop, and `AHP.md` and the spec say how a stop is answered | [code://packages/sdk/test/ahp-test-cases.test.ts#L515-L519](../../../../packages/sdk/test/ahp-test-cases.test.ts#L515-L519) | 01 |

## Proposed architecture

- **Validation** - the host reads the running turn the chat's held state has; a stop that names none of it is the client's action said back.
- **Backend call** - only a stop of the running turn reaches a backend, as now.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A stop that stops nothing is echoed](task-01-a-stop-that-stops-nothing-is-echoed.md) | done | - |

## Risks and tradeoffs

- A client that sent a stop as its turn ended is answered with its own stop, which its reducer leaves as nothing.
- A sleeping session's stop is answered without the restore that VS Code's host makes first.
- No VS Code client can tell a wake, and nothing is started to find no turn.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a worker chat's running turn is the host's own, held in the worker chat's state.

## Final verification checklist

- [x] Each new or changed case fails on `6e6d1ca8` for the reason it names, and passes after the change.
- [x] Every protocol case passes through the host.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
