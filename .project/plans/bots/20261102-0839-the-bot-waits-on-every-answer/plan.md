---
title: The bot waits on every answer and hands on the message whole
domain: bots
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
requires:
  - plans/host/20261102-0759-the-answer-is-the-clients-own-action/plan.md
refs:
  - git://c3c8c3e4 - the commit this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L19-L32 - a client holds an action until its echo or its refusal"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L254-L261 - a chat attachment travels on the ordinary message"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - `dispatcher`, the bot's own connection"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts) - `messageOf`, `beginTurn` and `ChatMessage`"
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts) - the turn and the steer a back session is sent"
---

## Goal

The bot is a client of its own host, and it takes a dispatch as taken or refused only when the host answers it.
The message a person sends a bot reaches the back session whole: the model and agent it named, and its attachments.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "ECHO_MS|silent" packages/bot/src` - a dispatch unanswered in 10 seconds is taken.
- `rg -n "messageOf\(|turn\(block" packages/bot/src` - the text alone reaches the back session.

### Runtime path

```
person -> bot chat begin(text, model, from, attachments) -> onMessage {text}
  -> wake turn(block, text) -> back session chat/turnStarted {message: {text}}
```

### Gaps

- A dispatch the host has not answered in 10 seconds is taken as accepted.
- The model, the agent and the attachments of a message are dropped on the way to the back session.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A dispatch is settled by the host's answer alone | reconciliation.md L19-L32; the host answers every dispatch; no VS Code client is the bot | 01 |
| The back session is handed the message's model, agent and attachments | chat-channel.md L254-L261; no VS Code client is the bot | 02 |

## Proposed architecture

- **Data flow** - the bot chat tells the plugin the whole message, and the wake builds the back session's message from it.
- **Layer responsibilities** - bot: `plugin.ts`, `chat.ts`, `wake.ts`.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a dispatch waits for its answer](task-01-a-dispatch-waits-for-its-answer.md) | done | - |
| [02 - the message is handed on whole](task-02-the-message-is-handed-on-whole.md) | done | - |

## Risks and tradeoffs

- A host that never answers a dispatch leaves the bot's send waiting; the host answers every dispatch it is sent.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none in this plan.
- **Open questions:** none.
- **Watch out for:** the steer carries no model, since `Session.steer` is handed none.

## Final verification checklist

- [x] Each new case fails on c3c8c3e4 and passes after the change.
- [x] `pnpm run typecheck` reports no errors.
