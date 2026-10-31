---
title: A steering message is answered when it is taken, and taken out when the agent reads it
domain: host
status: planned
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
refs:
  - git://ab07054c - the commit of ahpd this plan was checked at
  - "[code://packages/agent-claude/src/session/turns.ts#L661-L676](../../../../packages/agent-claude/src/session/turns.ts#L661-L676) - Claude's `steer`: the message held in the chat's state and said inside the dispatch"
  - "[code://packages/agent-claude/src/session/query.ts#L275-L280](../../../../packages/agent-claude/src/session/query.ts#L275-L280) - and taken out where the CLI reads it"
  - "[code://packages/agent-pi/src/session.ts#L1340-L1367](../../../../packages/agent-pi/src/session.ts#L1340-L1367) - pi's `steer`, which hands the message to pi and says nothing"
  - "[code://packages/agent-pi/src/backend.ts#L44](../../../../packages/agent-pi/src/backend.ts#L44) - the backend's `steer`, which drops what pi did with the message"
  - "[code://packages/bot/src/chat.ts#L990-L1009](../../../../packages/bot/src/chat.ts#L990-L1009) - the bot's `steer`, which ends the open turn and starts one under a fresh id with nothing naming the message"
  - "[code://packages/sdk/src/host/chatactions.ts#L1219-L1233](../../../../packages/sdk/src/host/chatactions.ts#L1219-L1233) - a client's steering message, handed to the session with nothing owed for it"
  - "[code://packages/sdk/src/sessions/nested.ts#L1308-L1313](../../../../packages/sdk/src/sessions/nested.ts#L1308-L1313) - the proxy hands it to the host inside, whose answer comes back later"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L374-L381 - a steering message is consumed by `chat/pendingMessageRemoved` with `kind: 'steering'`, then injected"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L899-L929 - the reducer holds it in `steeringMessage`, and a removal or a turn naming it clears that"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L30 - a client holds its action until an envelope with its own origin, or a rejection, answers it"
  - "pi's `AgentSession` (`@earendil-works/pi-coding-agent` 1.3.0, dist/core/agent-session.js `_queueSteer`, `_emitQueueUpdate` and the user `message_start` it reads a steering message off at) - pi says its steering queue on every change"
---

## Goal

A steering message a client sends while a turn runs is answered at once with its own origin, held in the chat's state while it waits, and taken out when the agent reads it, in pi, in the bot, and in a session inside a machine, as the Claude session does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "steer" packages/*/src` - Claude says the message and takes it out; pi hands it to pi and says nothing; the bot ends the turn and opens another that names nothing; the nested proxy hands it on and the host inside answers.
- `rg "queue_update" packages/agent-pi` - pi's queue events are read nowhere.
- `rg "owe\(" packages/sdk/src/host` - a queued message is owed, a steering one is not, so an answer that comes back from a machine finds no client.

### Gaps

- pi: the client's steering message is never answered, the chat's state never holds it, and nothing takes it out when pi reads it.
- The bot: the client's steering message is never answered, and the turn that takes it in names nothing, so a client that holds it holds it for good.
- A session in a machine: the host inside answers the proxy, and the answer goes out with no origin, because nothing was owed for the message.

## Answers

| What | Source | Task |
| --- | --- | --- |
| pi says the message inside the dispatch, holds it as the chat's `steeringMessage`, and takes out each message pi's queue no longer holds | Claude's `steer`; pi's `queue_update`, said on every change of its steering queue | 01 |
| The bot says the message inside the dispatch and starts the turn that takes it in with `queuedMessageId` naming it | the reducer clears `steeringMessage` for a turn that names it | 02 |
| The host owes a client's steering message as it owes a queued one, so a backend that answers later answers with the client's origin | `owed`, and the proxy's `start.handed` | 03 |

## Proposed architecture

- **Event flow** - a client's `chat/pendingMessageSet` with `kind: 'steering'` reaches the host, which owes it and hands it to the session; the session says it back inside the dispatch, or later through `start.handed`; the session takes it out with `chat/pendingMessageRemoved`, or with the turn that takes it in, once the agent reads it.
- **Layer responsibilities** - the host: who a steering message answers. pi and the bot: when the agent reads it.
- **Source-of-truth files** - [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts), [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi answers a steering message and takes it out when pi reads it](task-01-pi-answers-a-steering-message.md) | todo | - |
| [02 - The bot answers a steering message and names it on the turn that takes it in](task-02-the-bot-answers-a-steering-message.md) | todo | - |
| [03 - The host owes a steering message, so a session in a machine answers it](task-03-the-host-owes-a-steering-message.md) | todo | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned 2026-10-31.
- **Next action:** [task-01-pi-answers-a-steering-message.md](task-01-pi-answers-a-steering-message.md).
- **Open questions:** none.
- **Watch out for:** cofold holds a steering message the same way; that half goes with upstream's cofold resume plan (#177), which reshapes its turn opening.

## Final verification checklist

- [ ] Each new case fails on `ab07054c` for the reason it names, and passes after the change.
- [ ] The touched suites pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors.
