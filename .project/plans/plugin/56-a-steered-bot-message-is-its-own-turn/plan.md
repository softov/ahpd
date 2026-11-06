---
title: A steered bot chat message is its own turn
domain: plugin
status: built
priority: high
created: 2026-10-22
revalidated: 2026-10-22
requires: []
changes: []
creates: []
refs:
  - "[code://packages/bot/src/chat.ts#L979-L986](../../../../packages/bot/src/chat.ts#L979-L986) - `steer`, which logs the message and tells no client"
  - "[code://packages/bot/src/chat.ts#L347-L350](../../../../packages/bot/src/chat.ts#L347-L350) - `logAt`, which skips every `steering` line on reload"
  - "[code://packages/bot/src/chat.ts#L772-L796](../../../../packages/bot/src/chat.ts#L772-L796) - `beginTurn`, the one place a person's message becomes visible"
  - "[code://packages/bot/src/chat.ts#L664-L710](../../../../packages/bot/src/chat.ts#L664-L710) - `finish`, which ends a turn and starts the next queued one"
  - "[code://packages/bot/src/wake.ts#L420-L434](../../../../packages/bot/src/wake.ts#L420-L434) - `answering`, keyed with the turn that woke the back session"
  - "[code://packages/bot/test/bot-chat.test.ts#L364-L396](../../../../packages/bot/test/bot-chat.test.ts#L364-L396) - the test that makes the hidden steer the intended behaviour"
---

## Goal

A message a person sends in a bot chat while a turn runs shows in the bot chat as its own turn.
The back session's answer after it lands under that turn, live and after a restart.

## Reconnaissance

The files read are the `refs` above, each with its note.
Softov saw it on 2026-10-22: a "stop that" sent during a turn steered the back session, and the bot chat never showed it.

### Searches performed

- `rg -n "steering" packages/bot/src` - a steer is a log line marked `steering`, and the reader skips it.
- `rg -n "pendingMessageSet" packages/bot/src packages/agent-claude/src` - the bot chat sends no action for a steer.

### Runtime path

```
client chat/pendingMessageSet steering -> bot chat steer -> end the open turn as complete, no queued start
  -> begin a new turn with the steered text -> onMessage -> wake: steer into the back session
  -> back session answers -> the new turn shows the answer
```

### Gaps

- A steered message is never shown in the bot chat, live or after a reload.
- The back session's answer to it lands under the turn of the first message.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A steer ends the open turn and starts a new turn with the steered text, and the answer after it lands in the new turn | Softov, 2026-10-22, chose "Its own turn" | 01 |
| The ended turn keeps what it holds so far and ends as `complete` | (defaulted: the real session on the right shows the first turn as completed) | 01 |
| A queued message waits until the steered turn ends; the split never starts it | (defaulted: a steer is in front of the queue) | 01 |
| The new turn shows the same back-session chat as a subagent call | (defaulted: the person still waits on the same chat) | 01 |
| A log written before this plan keeps its `steering` lines, and a reload reads each one as a turn of its own | (defaulted: one reader for old and new logs) | 01 |
| The steered turn carries the sender of the steered message, through an optional `from` on `steer` | Softov, 2026-10-30, chose "Add a task to 56" | 02 |

## Proposed architecture

- **Data flow** - `steer` ends the open turn and begins a new one, so the log holds two turn lines.
- **Event flow** - `chat/turnComplete` for the first turn, then `chat/turnStarted` with the steered message.
- **State flow** - `answering` in `wake.ts` follows the new turn id.
- **Layer responsibilities** - bot: the split, the reader and the wake key. docs: the changelog.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A steer starts its own turn](task-01-a-steer-starts-its-own-turn.md) | done | - |
| [02 - A steered turn carries its sender](task-02-a-steered-turn-carries-its-sender.md) | done | 01 |

## Risks and tradeoffs

- A steer that the back session reads late can put part of the first answer under the new turn.
  The split follows the person's message, not the model's reading of it.

## Resume state

- **Done so far:** tasks 01 and 02 are implemented. A steer ends the open turn and begins one of its own; a reload reads it, and the wake's answer follows the new turn. The steered turn carries the sender of the steered message, through the optional `from` on `Session.steer`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `finish` calls `startNext`, so the split uses the new `next` parameter to leave the queue waiting.

## Final verification checklist

- [ ] A message sent in a bot chat while a turn runs shows as its own turn, live.
- [ ] After a daemon restart, the bot chat shows the same two turns.
