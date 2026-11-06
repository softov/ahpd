---
title: A reopened bot chat keeps its mark
domain: plugin
status: built
priority: high
created: 2026-10-25
revalidated: 2026-10-25
refs:
  - "[code://packages/sdk/src/types/agent.ts#L128-L138](../../../../packages/sdk/src/types/agent.ts#L128-L138) - `Listed`, the row a backend answers, with no `_meta`"
  - "[code://packages/sdk/src/host/catalogue.ts#L1000-L1026](../../../../packages/sdk/src/host/catalogue.ts#L1000-L1026) - `adopt`, which turns a listed row into a summary for `list` and `find` alike"
  - "[code://packages/sdk/src/host/facts.ts#L190-L202](../../../../packages/sdk/src/host/facts.ts#L190-L202) - `agentMeta`, empty for a session that is not running"
  - "[code://packages/sdk/src/host/facts.ts#L240-L262](../../../../packages/sdk/src/host/facts.ts#L240-L262) - `describes`, which spreads `agentMeta` into the row, the state and the notification"
  - "[code://packages/sdk/src/host/snapshots.ts#L555](../../../../packages/sdk/src/host/snapshots.ts#L555) - the browsed state of a session that is not running, built with `describes`"
  - "[code://packages/bot/src/chat.ts#L238-L245](../../../../packages/bot/src/chat.ts#L238-L245) - `markOf`, the bot's mark"
  - "[code://packages/bot/src/chat.ts#L387-L408](../../../../packages/bot/src/chat.ts#L387-L408) - `rowOf`, which reads the mark from the log and drops it"
  - "[code://packages/bot/src/chat.ts#L880-L916](../../../../packages/bot/src/chat.ts#L880-L916) - the running chat's `sessionState` and `chatState`, which carry the mark"
---

## Goal

A client draws a bot chat as a bot chat from its first frame, also when the chat is not running.
Today ahpw draws the plain session view for a reopened bot chat, and switches to bot bubbles only after the first message starts the chat.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `git grep -n "Listed\b" -- packages/sdk/src` - `adopt` is the one place a listed row becomes a summary, for `list` (catalogue.ts) and `find` (history.ts).
- `git grep -n "agentMeta(" -- packages/sdk/src` - one caller, `describes`, which the summary, the browsed state and the notifications all spread.

### Runtime path

```
bot rowOf -> Listed -> host adopt -> describes -> agentMeta -> summary and browsed state _meta -> ahpw sessions Page
```

### Gaps

- `Listed` has no `_meta`, so a backend cannot say anything about a session that is not running.
- `agentMeta` reads only the running agent, so a reopened chat has no bot mark.
- `rowOf` reads the mark from the log and uses it only for the title.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `Listed` gets an optional `_meta`, and the host carries it onto the summary and the state of a session that is not running | Softov, 2026-10-25: "a plan then dispatch the builder for the fix" | 01 |
| The running agent's `_meta` replaces the listed one once the session runs | (defaulted: the running agent knows the session as it is now) | 01 |
| The host keys win a collision with a listed key, as they do with a running agent's key | (defaulted: the rule `describes` already has) | 01 |
| `rowOf` sends the mark of the bot as it is now, from the store, and the mark in the log only when the bot is deleted | (defaulted: the title and folder already come from the store, and a running chat sends `markOf(bot)`) | 02 |
| ahpw needs no change | (defaulted: it already reads the mark from `_meta`) | - |

## Proposed architecture

- **Data flow** - the bot's `list` and `find` put the mark in `Listed._meta`. `adopt` keeps it for the session, and `agentMeta` answers it when nothing runs the session.
- **State flow** - when the session starts, the running agent's `_meta` replaces the kept one.
- **Layer responsibilities** - sdk: the `Listed` type and the host. bot: `rowOf`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/facts.ts`](../../../../packages/sdk/src/host/facts.ts), [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A listed row carries `_meta`](task-01-a-listed-row-carries-meta.md) | done | - |
| [02 - The bot's row carries its mark](task-02-the-bots-row-carries-its-mark.md) | done | 01 |

## Risks and tradeoffs

- A backend can put any key in `Listed._meta` - the host already takes any key from a running agent's `_meta`, so this is the same trust.
- A kept `_meta` for every listed session costs memory - it is one small map for each row, as `births` and `moves` already are.

## Resume state

- **Done so far:** both tasks are implemented. `Listed` carries an optional `_meta`; the host answers it while nothing runs, and `rowOf` sends the bot's mark.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `_meta` is replaced whole, never merged. Compose the listed keys and the host keys in `describes`, as the running agent's keys are.

## Final verification checklist

- [x] A reopened bot chat's summary and browsed state carry the bot's mark, with nothing running.
- [x] A chat whose bot is deleted carries the mark from its log.
- [x] Once the chat runs, the state carries the running agent's `_meta`.
- [x] `plans/index.md` updated.
