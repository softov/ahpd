---
title: A cancel with no turn running is refused
domain: host
status: draft
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0207-the-protocol-cases-are-the-oracle/plan.md
changes:
  - specs/sessions-and-chats.md
refs:
  - git://c7899eff - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L359 - the server validates a client action before it applies it, and `chat/turnCancelled` with no active turn: \"Server MUST reject the action\""
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L186-L188 - a turn ends only when the id the action names is the active turn's"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts#L452-L461 - `chat/turnCancelled` names its turn by `turnId`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1164-L1213](../../../../packages/sdk/src/host/chatactions.ts#L1164-L1213) - the stop: echoed to its sender when no turn runs, and handed to the backend under the id the client gave"
  - "[code://packages/sdk/src/host/chatactions.ts#L481-L505](../../../../packages/sdk/src/host/chatactions.ts#L481-L505) - an action on a session asleep in the catalogue wakes the session first"
  - "[code://packages/sdk/src/types/session.ts#L629-L630](../../../../packages/sdk/src/types/session.ts#L629-L630) - `cancel`, which names no contract for the id it is handed"
  - "[code://packages/bot/src/chat.ts#L1015-L1029](../../../../packages/bot/src/chat.ts#L1015-L1029) - the bot's stop, with a guard of its own for a turn the chat is not running"
  - "[code://packages/agent-acp/src/session.ts#L289-L291](../../../../packages/agent-acp/src/session.ts#L289-L291) - ACP stops only the turn its id names, so an empty id stops nothing"
  - "[code://packages/agent-cofold/src/session.ts#L351-L354](../../../../packages/agent-cofold/src/session.ts#L351-L354) - cofold stops only the turn its id names"
  - "[code://packages/agent-pi/src/session.ts#L1484-L1485](../../../../packages/agent-pi/src/session.ts#L1484-L1485) - pi stops only the turn its id names"
  - "[code://docs/sdk/AHP.md#L760-L763](../../../../docs/sdk/AHP.md#L760-L763) - \"A cancel is the same case\": a stop with no turn running answered as an unchanged set is"
  - "[code://.project/specs/sessions-and-chats.md#L86-L98](../../../specs/sessions-and-chats.md#L86-L98) - a stop in a worker chat"
  - "[code://.project/plans/host/97-an-unchanged-client-set-is-echoed-back/task-03-an-idle-cancel-is-echoed-to-its-sender.md](../97-an-unchanged-client-set-is-echoed-back/task-03-an-idle-cancel-is-echoed-to-its-sender.md) - the answer this plan reverses, which the specification's validation row outranks"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L656-L685](../../../../packages/sdk/test/host-catalogue.test.ts#L656-L685) - the test that holds the echo of a stop with no turn running"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the protocol case driver; case 015 stops a turn the host's chat is not running"
---

## Goal

A client that stops a chat with no turn running is refused, as the protocol's validation table has a server reject it.
The refusal comes before anything is woken or asked of a backend.
A stop that names another turn than the running one stops nothing, and its sender alone is answered.
A stop of the running turn reaches the backend under that turn's own id, so every backend stops it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "turnCancelled" packages/sdk/src/host/chatactions.ts` - one handler, with a lead chat path and a worker chat path.
- `rg -n "cancel: \(" packages/*/src examples` - seven backends take a stop, and they read its id in three ways.
- Claude and the example backends stop the running turn whatever the id.
- The pi, ACP and cofold backends stop only the turn the id names.
- The bot stops its open turn for that turn's id or an empty one, and the nested proxy carries the id inward.
- `rg -n "turnCancelled" packages/*/test` - one test holds the echo of a stop with no turn running; the worker chat tests stop a running worker.
- The protocol's reducer cases through the host: only case 015 stops a turn, and the host's chat runs none there.

### Runtime path

```
client chat/turnCancelled -> applyDispatch -> chatAction
  a session asleep: woken, then the action applied again
  a lead chat: the backend's activeTurn read; none -> echo to the sender; another id -> echo to the sender
  otherwise -> owe the echo under the running turn -> session.cancel(the client's id)
  a worker chat: stopWorker(call) whatever the worker chat runs; without it, the lead turn
```

### Gaps

- A stop with no turn running is echoed to its sender as accepted, where chat-channel.md has the server reject it (A7).
- A stop on the chat of a worker that has ended reaches `stopWorker`.
- Claude then stops the lead turn when it holds no task for the worker.
- A stop on a session asleep in the catalogue wakes the session, which runs no turn to stop.
- A stop that names no turn reaches the backend as an empty id, so pi, ACP and cofold stop nothing (C1).
- The host owes its echo under the running turn all the same, and nothing answers it.
- `Not found: a test of a stop on a worker chat whose worker has ended - searched subagent-chat.test.ts and agent-claude-subagent.test.ts.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| A stop on a chat that runs no turn is refused, on a lead chat and on a worker chat, whatever turn it names | [chat-channel.md#L353](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L353) | 01 |
| The refusal says `Nothing is running on <chat> to stop` | [code://packages/sdk/src/host/chatactions.ts#L1207](../../../../packages/sdk/src/host/chatactions.ts#L1207) | 01 |
| A stop on a session asleep in the catalogue is refused without a wake, since a session with no backend runs no turn | [chat-channel.md#L353](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L353) | 01 |
| A stop naming another turn than the running one on a lead chat stays an echo to its sender alone | [reducer.ts#L186-L188](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L186-L188) | 01 |
| A stop naming no turn names the running one, as now | [code://packages/sdk/src/host/chatactions.ts#L1180-L1182](../../../../packages/sdk/src/host/chatactions.ts#L1180-L1182) | 02 |
| The backend is handed the running turn's id, the turn the host owes the echo under | [code://packages/sdk/src/host/chatactions.ts#L1196](../../../../packages/sdk/src/host/chatactions.ts#L1196) | 02 |
| `Session.cancel` says the host calls it with the id of the turn the chat runs, and only while one runs | [chat-channel.md#L345-L353](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L353) | 02 |
| The protocol case driver allows the refusal of `chat/turnCancelled` with the validation row as its source | [code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) | 01 |

## Proposed architecture

- **Event flow** - the host reads the running turn of the chat that a stop names.
- **Validation** - with no turn it refuses, and with another id it answers the sender alone.
- **Backend call** - otherwise the host hands the backend the running turn's id.
- **Layer responsibilities** - the host validates the stop against the chat it names; a backend stops the turn it is handed.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A stop with no turn running is refused](task-01-a-stop-with-no-turn-running-is-refused.md) | todo | - |
| [02 - The backend stops the turn the host names](task-02-the-backend-stops-the-turn-the-host-names.md) | todo | 01 |
| [03 - The docs say when a stop is refused](task-03-the-docs-say-when-a-stop-is-refused.md) | todo | 01, 02 |

## Risks and tradeoffs

- A stop sent as a turn ends is refused where it was echoed - a client drops its pending stop on either answer.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-stop-with-no-turn-running-is-refused.md](task-01-a-stop-with-no-turn-running-is-refused.md).
- **Open questions:** none.
- **Watch out for:** the worker chat's turn is the host's own, held in `subagents`, and the backend's `chatState` is the lead chat's.

## Final verification checklist

- [ ] Each new case fails on `c7899eff` for the reason it names, and passes after the change.
- [ ] Every protocol case passes through the host.
- [ ] The touched suites pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
