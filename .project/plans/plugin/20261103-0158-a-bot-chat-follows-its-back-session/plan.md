---
title: A bot chat follows its back session
domain: plugin
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://a8eff676 - the commit of ahpd this plan was checked at, and the last commit that holds briefs/a-bot-chat-follows-its-back-session.md, which this plan covers
  - "[code://packages/bot/src/chat.ts#L650-L653](../../../../packages/bot/src/chat.ts#L650-L653) - `withdrawAsked`, which since git://90efda43 only removes the request from the open turn's list"
  - "[code://packages/bot/src/chat.ts#L746-L796](../../../../packages/bot/src/chat.ts#L746-L796) - `TurnHandle` of one chat, which acts only on the open turn"
  - "[code://packages/bot/src/chat.ts#L809-L850](../../../../packages/bot/src/chat.ts#L809-L850) - `beginTurn`, which writes the line, says `chat/turnStarted` and calls `onMessage`"
  - "[code://packages/bot/src/chat.ts#L438-L458](../../../../packages/bot/src/chat.ts#L438-L458) - `handles` and `turns`, the handle of a chat this host is running, by its URI"
  - "[code://packages/bot/src/chat.ts#L1092-L1116](../../../../packages/bot/src/chat.ts#L1092-L1116) - the bot chat's own answers, which carry `turnId: held.id`"
  - "[code://packages/bot/src/ask.ts#L199-L206](../../../../packages/bot/src/ask.ts#L199-L206) - `withdrawn`, called on `input_needed_removed` of a back session"
  - "[code://packages/bot/src/wake.ts#L557-L570](../../../../packages/bot/src/wake.ts#L557-L570) - the wake holds the waiting turn in `answering` and shows `working`; the shape a back turn copies"
  - "[code://packages/bot/src/wake.ts#L442-L500](../../../../packages/bot/src/wake.ts#L442-L500) - `main`, `posted` and `finished`, which read `answering`"
  - "[code://packages/bot/src/wake.ts#L272-L287](../../../../packages/bot/src/wake.ts#L272-L287) - `started`, the bot of each back session, filled from the rows at load"
  - "[code://packages/bot/src/names.ts#L146-L198](../../../../packages/bot/src/names.ts#L146-L198) - `BackSessions`, the rows of bot, user, name and session"
  - "[code://packages/bot/src/names.ts#L99](../../../../packages/bot/src/names.ts#L99) - `whose`, the owner of a row's `user`"
  - "[code://packages/bot/src/provider.ts#L403](../../../../packages/bot/src/provider.ts#L403) - `chatRow`: one main chat for each bot and owner"
  - "[code://packages/bot/src/plugin.ts#L583-L608](../../../../packages/bot/src/plugin.ts#L583-L608) - the `turn_end` listener, which reads the back chat and calls `finished`; the `turn_start` listener copies it"
  - "[code://packages/bot/src/post.ts#L41](../../../../packages/bot/src/post.ts#L41) - `POST_INSTRUCTION`, true once a back turn has a waiting main turn"
  - "[code://packages/bot/src/post.ts#L80-L88](../../../../packages/bot/src/post.ts#L80-L88) - `post_message`, which refuses a session with no waiting main turn"
  - "[code://packages/sdk/src/types/events.ts#L98-L111](../../../../packages/sdk/src/types/events.ts#L98-L111) - `TurnStartEvent`: session, chat, turn and sender"
  - "[code://packages/sdk/src/host/chatactions.ts#L1484-L1499](../../../../packages/sdk/src/host/chatactions.ts#L1484-L1499) - a steer with no turn running runs as a turn, since git://a3662128"
  - plans/plugin/56-a-steered-bot-message-is-its-own-turn/plan.md - the steer path of the bot chat, which git://ca82b8af changed and this plan keeps
  - npm://@microsoft/agent-host-protocol@1.0.0 - `updateToolCallInParts` in `types/channels-chat/reducer.ts` ignores a tool call action whose `turnId` is not the active turn
---

## Goal

A person who uses a bot sees in the bot's main chat what its back session does.
A question that the person answers on the back session clears from the main chat at once.
A turn that the person starts on the back session shows in the main chat as a turn, and the back session's answer lands there.
The three faults Softov saw on 2026-11-02 with the bot `gumbo` are checked against what #193 changed.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "withdrawAsked|withdrawn" packages/bot/src` - one caller chain: `input_needed_removed`, then `ask.withdrawn`, then the handle's `withdrawn`.
- `git show 90efda43 -- packages/bot/src/chat.ts` - the removed code spliced the copy out and said `chat/inputCompleted` or `chat/toolCallConfirmed`, without `turnId`.
- `rg "turn_start" packages/bot/src` - the bot plugin does not listen to it.
- `rg "chatRow|sessionsOf" packages/bot/src` - a person has one main chat with each bot, and each back session row names its bot and user.

### Runtime path

```
back session turn starts -> host raises turn_start -> bot plugin: not a waiting session, a bot's back session
  -> back row (bot, user) -> chat row (bot, owner) -> turns(main chat) -> handle.begin(text)
  -> wake holds the main turn in answering -> working, asking, post_message, turn_end -> finished
```

### Gaps

- `TurnHandle` has no call that opens a turn without a person's message.
- `BackSessions` has no lookup from a session to its row.
- The wake has no entry point for a turn it did not start.
- `Not found: a turn_start listener in the bot plugin - searched "turn_start" in packages/bot/src.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| The copy of a question that the back session no longer asks clears at once, with the open turn's `turnId` | Softov, 2026-11-02, chose "Clear it at once" after #193 | 02 |
| A question's copy clears with `chat/inputCompleted` `cancel`, and a call's copy with `chat/toolCallConfirmed` `skipped`, as before git://90efda43 | (defaulted: the code that git://90efda43 removed, with `turnId` added) | 02 |
| The wake keeps no fix of its own. The host's run of a late steer as a turn covers both fixes | Softov, 2026-11-02, chose "Drop both" after #193 | 01 |
| A turn that starts on the back session opens a turn of its own in the main chat, and the back session's answer lands there | Softov, 2026-11-02, chose "A turn of its own" | 03 |
| The main chat of a back session is its owner's one main chat with the bot, found from the back row and the chat row | (defaulted: a back session row names one bot and one user, and `chatRow` keys one main chat by bot and owner) | 03 |
| A main chat that has a turn open opens no turn for a back turn. The back session runs as it does today | Softov, 2026-11-02, chose "Show nothing for it" | 03 |
| `post_message` in that turn posts into it | (defaulted: the main turn is held in `answering`, as a woken turn is) | 03 |
| The main turn's message is the back turn's text, with the back turn's sender when the event names one | (defaulted: the turn shows what the person said, where they said it) | 03 |
| A main chat that this host is not running opens no turn | (defaulted: `turns` answers only a running chat, and starting one would start a new chat) | 03 |

## Proposed architecture

- **Data flow** - the back turn's text comes from the back chat's state, read as `turn_end` reads it. The main chat comes from the stored rows.
- **Event flow** - `turn_start` of a back session opens a main turn. `input_needed`, `input_needed_removed` and `turn_end` act on it as they act on a woken turn.
- **State flow** - the main turn is an `answering` entry of the wake, as a woken turn is. `finished` or `posted` ends it.
- **Layer responsibilities** - `chat.ts`: `begin` and the copy · `names.ts`: a session's row · `wake.ts`: `began` · `plugin.ts`: the `turn_start` listener.
- **Source-of-truth files** - [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the back session checks pass](task-01-the-back-session-checks-pass.md) | todo | - |
| [02 - a withdrawn copy clears at once](task-02-a-withdrawn-copy-clears-at-once.md) | todo | - |
| [03 - a back turn opens a main turn](task-03-a-back-turn-opens-a-main-turn.md) | todo | 02 |

## Risks and tradeoffs

- Task 02 reverts part of MayCXC's git://90efda43. That commit follows VS Code: the host says no completion in nobody's name - the PR body gives Softov's choice.
- After a restart, a main chat that the host does not run shows no back turn - the person sees it on the back session.
- A main chat that waits on another back session shows no back turn - Softov chose this.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-back-session-checks-pass.md](task-01-the-back-session-checks-pass.md).
- **Open questions:** none.
- **Watch out for:** a test daemon writes Softov's `~/.config/ahpd` unless `XDG_CONFIG_HOME` points at a scratch folder. Never use ports 5180 or 37537.

## Final verification checklist

- [ ] A message sent on the main chat after the back turn ended starts a turn on the back session, with no notice.
- [ ] The session's `status` has no `InProgress` bit after an approval on the back session and the end of its turn.
- [ ] No "Steering" message stays on the back session after such a send.
- [ ] An approval answered on the back session clears its copy in the main chat at once, in a live client.
- [ ] A message typed on the back session opens a main turn that shows running, and the back session's `post_message` reply ends it.
- [ ] By hand: in ahpw, a message to a bot gets a reply, and the subagent call opens the back session. (Moved from [plan 52-p3](../52-p3-a-message-wakes-the-bot-and-it-replies/plan.md).)
- [ ] `pnpm --filter @ahpd/bot test` passes, run alone.
