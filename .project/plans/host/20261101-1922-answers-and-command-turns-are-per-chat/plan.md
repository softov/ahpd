---
title: Owed answers and command turns are held per chat
domain: host
status: planned
priority: high
created: 2026-11-01
revalidated: 2026-11-01
refs:
  - git://39d1f22a - the commit of ahpd this plan was checked at
  - "[code://.project/working/maycxc-union-20261101-review.md](../../../working/maycxc-union-20261101-review.md) - Softov's review: an owed answer keyed by the action's type and id alone, and `ctx.commandTurns` keyed by turn id across chats"
  - "[code://packages/sdk/src/host.ts#L751-L812](../../../../packages/sdk/src/host.ts#L751-L812) - the owed answers: `owedKey` is the action's type and the id it names, with no chat"
  - "[code://packages/sdk/src/host.ts#L877-L890](../../../../packages/sdk/src/host.ts#L877-L890) - a turn's end lets go of what it owed, under the same key"
  - "[code://packages/sdk/src/host.ts#L1208](../../../../packages/sdk/src/host.ts#L1208) - `owe`, which holds the dispatch being applied under that key"
  - "[code://packages/sdk/src/host.ts#L1003-L1040](../../../../packages/sdk/src/host.ts#L1003-L1040) - `refuse` and `echoTo`, which let go of the owed answer they give"
  - "[code://packages/sdk/src/host/chatactions.ts#L310-L319](../../../../packages/sdk/src/host/chatactions.ts#L310-L319) - which chat a client action is about: a chat channel names one, a session channel its default"
  - "[code://packages/sdk/src/host/chatactions.ts#L541](../../../../packages/sdk/src/host/chatactions.ts#L541) - a turn a client starts is owed, whatever chat it is in"
  - "[code://packages/sdk/src/host/spawn.ts#L1204-L1206](../../../../packages/sdk/src/host/spawn.ts#L1204-L1206) - a backend that answers later finds the dispatch through `answering`"
  - "[code://packages/sdk/src/host/context.ts#L145-L153](../../../../packages/sdk/src/host/context.ts#L145-L153) - `commandTurns`, by turn id while they run"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1394](../../../../packages/sdk/src/host/lifecycle.ts#L1394) - a `!` command's turn, held under its id"
  - "[code://packages/sdk/src/host/spawn.ts#L1263](../../../../packages/sdk/src/host/spawn.ts#L1263) - a queued command moved to its turn's id"
  - "[code://packages/sdk/src/host/spawn.ts#L1483-L1499](../../../../packages/sdk/src/host/spawn.ts#L1483-L1499) - a command turn's start and end, which put its chat's read bit back"
  - "[code://packages/sdk/src/host/changesets.ts#L155](../../../../packages/sdk/src/host/changesets.ts#L155) - `opKey`, the pattern for a key of a channel and an id"
  - "[code://packages/sdk/test/echo-origin.test.ts](../../../../packages/sdk/test/echo-origin.test.ts) - the origins a turn's echo carries, with a backend that answers later"
  - "[code://packages/sdk/test/host-terminals.test.ts](../../../../packages/sdk/test/host-terminals.test.ts) - a command typed into the conversation, and the read bit it leaves"
---

## Goal

A client names its own turns and messages, so two chats can each hold one of the same id at once.
The host keeps an answer it owes a client, and a `!` command's turn, under the chat as well as the id.
One chat's turn then never answers, ends or marks another chat's.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "owedKey|owedUnder|answeredBy|originOf|owe:" packages/sdk/src/host.ts` - one map, keyed by the action's type and the id it names.
- `rg -n "ctx.owe\(" packages/sdk/src` - four sites in chatactions.ts: a turn started, a turn stopped twice, a message queued.
- `rg -n "answering" packages/sdk/src` - the host's own lookup, and `Start.handed` in spawn.ts.
- `rg -n "commandTurns" packages/sdk/src` - five sites, each keyed by the turn id alone.

### Runtime path

```
client chat/turnStarted on chat A, turn t1 -> owe(turnStarted, t1)
client chat/turnStarted on chat B, turn t1 -> owe(turnStarted, t1), the same key, so A's entry is lost
backend A says chat/turnStarted t1 later -> originOf finds B's dispatch -> A's echo carries B's origin
backend B says chat/turnStarted t1 -> nothing owed -> B's echo carries no origin
```

### Gaps

- An owed answer is found by the action's type and id alone, so two chats with the same turn id share one entry.
- A refusal of one chat's dispatch lets go of the other chat's entry under the same key.
- `commandTurns` is keyed by the turn id alone, so one chat's command turn decides another chat's read bit at its end.
- `Not found: a test with two chats using one turn id - searched echo-origin.test.ts, host-senders.test.ts and host-terminals.test.ts.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| An owed answer is keyed by its chat, the action's type and the id it names | Softov, 2026-11-01, in the review: "Keying both by channel fixes the class." | 01 |
| The chat is the one the dispatch is about: a chat channel names that chat, a session channel its default chat | [code://packages/sdk/src/host/chatactions.ts#L310-L319](../../../../packages/sdk/src/host/chatactions.ts#L310-L319) | 01 |
| A command turn is keyed by its chat and its turn id | Softov, 2026-11-01, in the review: "`ctx.commandTurns` ... keyed by turn id across chats" and "Keying both by channel fixes the class." | 02 |
| The key is the chat and the id joined by a separator, as `opKey` joins a channel and an id | [code://packages/sdk/src/host/changesets.ts#L155](../../../../packages/sdk/src/host/changesets.ts#L155) | 01, 02 |

## Proposed architecture

- **Data flow** - `owe` keys the dispatch being applied by the chat it is about. An action said back is looked up by the chat it is said on.
- **State flow** - `commandTurns` holds a command turn under `commandTurnKey(chat, turn)` from its start, or its queued message, to its end.
- **Layer responsibilities** - sdk host: the two keys. No backend changes: a backend says its chat's actions on that chat's channel already.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an owed answer is keyed by its chat](task-01-an-owed-answer-is-keyed-by-its-chat.md) | todo | - |
| [02 - a command turn is keyed by its chat](task-02-a-command-turn-is-keyed-by-its-chat.md) | todo | - |

## Risks and tradeoffs

- A chat action sent on the session's channel is answered on the default chat's channel.
  The key reads the dispatch's chat as the chat actions do, so both sides name the default chat.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-owed-answer-is-keyed-by-its-chat.md](task-01-an-owed-answer-is-keyed-by-its-chat.md).
- **Open questions:** none.
- **Watch out for:** `chatOf` keeps a recorded session's URI as its own name, so it is not the chat a session channel's dispatch is about.

## Final verification checklist

- [ ] Two chats that start turn `t1` each get their own echo's origin.
- [ ] Two chats that run command turn `t1` each end read.
- [ ] A turn started on the session's channel still gets its echo's origin.
