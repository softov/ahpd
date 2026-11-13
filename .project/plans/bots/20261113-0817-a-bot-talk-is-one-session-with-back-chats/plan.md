---
title: A talk with a bot is one session with its Back chats
domain: bots
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
requires:
  - plans/host/20261113-0817-a-plugin-chat-has-an-origin-and-tools/plan.md
  - plans/host/20261113-0817-an-agent-sets-a-new-sessions-folder/plan.md
changes:
  - specs/bots.md
creates: []
refs:
  - git://6418b8521 - the commit of ahpd this plan was checked at
  - git://6418b8521 - the last commit that holds `briefs/bot-master-chat.md`, `problems/a-bot-chat-is-not-a-subagent-of-its-back-session.md` and `problems/a-reader-of-a-bot-can-drive-its-trusted-session.md`, which this plan covers
  - git://ff5093883 - the commit that made a chat with a bot a session a client makes, and removed `bot:chat`
  - "[code://packages/bot/src/chat.ts#L1286-L1326](../../../../packages/bot/src/chat.ts#L1286-L1326) - the `bot-chat` agent: its one setting `bot`, offered as completions to every client, VS Code included"
  - "[code://packages/bot/src/chat.ts#L1376-L1392](../../../../packages/bot/src/chat.ts#L1376-L1392) - `create`: where the chat grant, the refusal and the Front row go"
  - "[code://packages/bot/src/chat.ts#L522-L541](../../../../packages/bot/src/chat.ts#L522-L541) - a Front opens from its log with no turn open, after a restart too"
  - "[code://packages/bot/src/provider.ts#L271-L278](../../../../packages/bot/src/provider.ts#L271-L278) - `mayRead`, the check a chat uses today"
  - "[code://packages/bot/src/provider.ts#L528](../../../../packages/bot/src/provider.ts#L528) - the read of `bot://<slug>`, which gets the reader's `session`"
  - "[code://packages/bot/src/record.ts#L113](../../../../packages/bot/src/record.ts#L113) - the record's `session` word, which goes"
  - "[code://packages/bot/src/wake.ts#L299-L335](../../../../packages/bot/src/wake.ts#L299-L335) - `sessionFor`: its folder, trust and computer move to the Front, its provider, model and tool to the Back chat"
  - "[code://packages/bot/src/wake.ts#L337-L362](../../../../packages/bot/src/wake.ts#L337-L362) - the maps kept between a Back session and its Front turn"
  - "[code://packages/bot/src/wake.ts#L397-L420](../../../../packages/bot/src/wake.ts#L397-L420) - `cancelSubagent`, kept for the Back chat"
  - "[code://packages/bot/src/wake.ts#L462-L530](../../../../packages/bot/src/wake.ts#L462-L530) - `sessionNamed`, which the Back chat lookup replaces"
  - "[code://packages/bot/src/wake.ts#L549-L558](../../../../packages/bot/src/wake.ts#L549-L558) - the queued message, sent to the Back chat as today"
  - "[code://packages/bot/src/post.ts#L80-L90](../../../../packages/bot/src/post.ts#L80-L90) - `post_message` finds the Front from `at.session`"
  - "[code://packages/bot/src/plugin.ts#L702-L711](../../../../packages/bot/src/plugin.ts#L702-L711) - a turn a person types in the Back stays in the Back"
  - "[code://packages/sdk/src/types/host.ts#L1598-L1601](../../../../packages/sdk/src/types/host.ts#L1598-L1601) - a tool call names its chat"
  - "[code://packages/sdk/src/types/plugin.ts#L1166-L1246](../../../../packages/sdk/src/types/plugin.ts#L1166-L1246) - `PluginHost` reads one session's owner and lists no sessions, so the Front needs a row"
  - "[code://packages/bot/src/plugin.ts#L67-L73](../../../../packages/bot/src/plugin.ts#L67-L73) - the plugin's option defaults, where `secondSession` goes"
  - "[code://packages/webhook/src/plugin.ts#L247-L300](../../../../packages/webhook/src/plugin.ts#L247-L300) - the webhook: one session for each bot, a chat for each caller thread"
  - "[code://.project/plans/bots/20261028-0545-a-bot-session-has-a-front-and-backs/plan.md](../20261028-0545-a-bot-session-has-a-front-and-backs/plan.md) - the draft that keeps groups, the private session and the other wakes"
---

## Goal

A bot is a system a person talks to, not an AI chat.
The person writes in the Front, a harness works in a Back chat of the same session, and only what the bot posts comes back.
One person has one session with one bot, so the bot keeps its memory of that person from one talk to the next.
Today each talk is a `bot-chat` session, and the work runs in a separate Back session.
Since `ff5093883`, a person who may only read a bot can also chat with it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "new Map" packages/bot/src` - the wake keeps five maps from a Back session to its Front turn; `ask.ts` and `chat.ts` keep two each.
- `rg -n "createSession|createChat" packages/webhook/src` - the webhook makes one session for each bot and a chat for each thread.
- `rg -n "subagentChats|linkOf" ../ahpw/src` - ahpw lists a `tool`-origin chat as a subagent and follows the `subagent` call's link.
- `rg -n "sessionOwner|startSession|startChat" packages/sdk/src/types/plugin.ts` - a plugin cannot list sessions by owner.

### Runtime path

```
client createSession(bot-chat, bot) -> placeSession: bot folder, trust, computer -> create: bot:chat, refuse a second, write the Front row
person -> Front turn -> wake -> Back chat: the session's chat whose origin names this Front, else startChat -> queued message
Back: post_message -> at.chat -> origin -> Front turn
person types in the Back -> a Back turn, as today
restart -> a Front turn begun and not ended reopens -> wake again -> Back -> reply in that turn
read bot://<slug> -> the reader's session in `session`
```

### Gaps

- A person can open many sessions with one bot, and nothing finds the one they had.
- The Back is a separate session, so the bot keeps maps between two sessions.
- A Front session runs in the client's folder, not the bot's.
- A person who may only read a bot can chat with it, trusted, in its folder.
- A restart leaves the person's message with no reply.
- `Not found: a Back chat in the Front's session - searched "startChat" in packages/bot/src.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| One session for each bot and person, with the Backs as chats inside it | Softov, 2026-11-13, "2 + 3 seen reasonable" | 01, 03 |
| A second create for the same bot and person is a setting, `refuse` by default | Softov, 2026-11-13, "configurable, refuse by default." | 01 |
| The setting is the bot plugin option `secondSession: refuse \| allow` | Softov, 2026-11-13, chose "Bot plugin option" and "secondSession: refuse \| allow" | 01 |
| The refusal names the existing session; VS Code finds the session in its session list | Softov, 2026-11-13, chose "Refuse, name the session" after "how vscode will work then?" | 01 |
| A plugin's own sessions are not refused | Softov, 2026-11-13, chose "No, plugins are exempt" | 01 |
| The read of `bot://<slug>` answers the reader's session in the field `session`, and starts nothing | Softov, 2026-11-13, chose "session" | 01 |
| With `allow`, the read answers the last used session | Softov, 2026-11-13, chose "The last used one" | 01 |
| A person's sessions from before this plan: the last used one becomes theirs, and the others stay and work | Softov, 2026-11-13, chose "Last used one is theirs" | 01 |
| A chat with a bot needs `bot:chat`, apart from read; the bot's owner needs none | Softov, 2026-11-13, chose "Yes: a chat grant, apart from read" | 01 |
| The Front session runs in the bot's folder, trusted, with no user settings, on the bot's computer | Softov, 2026-11-13, chose "Host lets the agent set them" and "Yes, the hook sets it" | 02 |
| The Back chat is writable: a turn the person types there stays in the Back, as today | Softov, 2026-11-13, chose "Writable, as today" | 03 |
| The Back chat has a `tool` origin naming the Front chat and its `subagent` call | Softov, 2026-11-13, chose "Tool origin, as a subagent" | 03 |
| The bot finds the Back by its id, from the session's chats and their origin, with no row and no name | Softov, 2026-11-13, "Why the fuck do not use the fucking ID?" | 03 |
| The record's `session` word goes, and with it a new Back for each message (`{turn}`) | Softov, 2026-11-13, chose "Drop it" | 01, 03 |
| `post_message` finds the Front from the calling chat's origin | Softov, 2026-11-13, chose "From the calling chat's origin" | 03 |
| Back sessions from before this plan stay as they are, and the next message starts a Back chat | Softov, 2026-11-13, chose "Stay as they are" | 03 |
| After a restart, a Front turn left open reopens, the bot wakes again, and the reply lands in that turn | Softov, 2026-11-13, "A wake or something else must happen to make the bot work again and reply"; chose "The same turn reopens" | 04 |
| The webhook option `threadSessions`: `false` by default is one session for each bot, `true` is a session for each thread | Softov, 2026-11-13, chose "One session per bot" and "threadSessions: true \| false" | 05 |
| A Back chat of a bot that names no agent runs on the host's default agent | Softov, 2026-11-13, chose "Host's default agent" | 03 |
| A talk is kept by the session's owner, and every root owner is one talker, `root` | Softov, 2026-11-13, chose "Count by owner" | 01 |
| A plugin's turn in a session it does not own is checked and charged as the session owner's | Softov, 2026-11-13, chose "The talk's owner" | 03 |
| A Back chat is titled `@main/<bot>/<person>`, with `main` fixed for now | Softov, 2026-11-13, wrote "@main/telly/softov" | 03 |
| The Front is a chat: the Back reaches it at any time through its origin, and a bot turn with origin `agent` holds what comes while no turn waits | Softov, 2026-11-13, chose "In bot-talk now" | 03 |
| A subagent messages its Back with `send_message`, offered in bot talks where `sessionTools` is off | Softov, 2026-11-13, chose "Offer send_message in bot talks" | 03 |

## Proposed architecture

- **Data flow** - the Front row `bots/<slug>/fronts` maps a person to their session id, because a plugin cannot list sessions. The Back has no row: it is the session's chat whose `tool` origin names the Front chat.
- **Event flow** - a Front turn wakes the Back chat with a queued message, as today. The Back's `post_message` call carries its chat, and the chat's origin names the Front.
- **State flow** - the session's chat catalogue holds the Back chats, and the host restarts them from their records. The Front's log says which turn a restart left open.
- **Layer responsibilities**:
  - `packages/bot/src/chat.ts`: the Front, the refusal, `placeSession`, the reopened turn.
  - `packages/bot/src/provider.ts`: `bot:chat` and the read's `session`.
  - `packages/bot/src/wake.ts`: Back chats. `packages/bot/src/post.ts`: the post.
  - `packages/webhook`: `threadSessions`.
- **Source-of-truth files** - [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - one-session-for-each-bot-and-person](task-01-one-session-for-each-bot-and-person.md) | implemented | - |
| [02 - the-front-runs-in-the-bots-folder](task-02-the-front-runs-in-the-bots-folder.md) | implemented | - |
| [03 - the-back-is-a-chat-of-the-front](task-03-the-back-is-a-chat-of-the-front.md) | implemented | 01, 02 |
| [04 - a-restart-wakes-the-bot-again](task-04-a-restart-wakes-the-bot-again.md) | implemented | 03 |
| [05 - the-webhook-picks-its-session-shape](task-05-the-webhook-picks-its-session-shape.md) | implemented | 03 |
| [06 - docs-and-spec](task-06-docs-and-spec.md) | implemented | 04, 05 |

## Risks and tradeoffs

- This reverses the part of `ff5093883` where a person has many sessions - `allow` keeps that behaviour for an operator who wants it.
- A refused create in VS Code shows an error - the error names the session, and VS Code lists it.
- Team members who chat with a team bot today lose that until they get `bot:chat`.
- A person who types in the Back talks to the harness directly - only the session's owner can, and the bot's owner gave them `bot:chat`.
- A restart wake sends the person's message to the Back twice - the Back's transcript shows the second turn what the first did.

## Resume state

- **Done so far:** tasks 01 to 06 are `implemented`, waiting for review, with the two host plans, in the branch `bots/20261113-0817-a-bot-talk-is-one-session`.
- **Next action:** Softov's review, and the restart check by hand on the test daemon.
- **Open questions:** none.
- **Watch out for:** the webhook's sessions are owned by the plugin, not a person, so the refusal skips them.

## Final verification checklist

- [ ] Luiz opens Ello from the bot page twice and gets the same session; a second create from VS Code is refused with its address.
- [ ] Maria, who may only read Ello, cannot open a session with it.
- [ ] A message in the Front wakes a Back chat in the same session, and ahpw lists it as a subagent.
- [ ] Luiz's second talk with Ello continues the same Back chat.
- [ ] Luiz types in the Back, and the reply stays in the Back.
- [ ] `post_message` from the Back lands in the Front turn; a stop of the Front turn stops the Back.
- [ ] A restart during a reply reopens the Front turn, and the bot replies in it.
- [ ] The webhook works with `threadSessions` `false` and `true`.
- [ ] `pnpm typecheck` and the `packages/bot`, `packages/webhook` tests pass.
- [ ] `.project/specs/bots.md`, `docs/plugins/BOTS.md` and `docs/plugins/WEBHOOKS.md` say what the code does.
