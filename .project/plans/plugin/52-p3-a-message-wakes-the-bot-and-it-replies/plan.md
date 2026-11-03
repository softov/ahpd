---
title: A message wakes the bot and it replies
domain: plugin
status: built
priority: medium
created: 2026-10-16
revalidated: 2026-10-17
requires:
  - plans/plugin/52-p2-a-bot-chat-is-a-session-with-no-harness/plan.md
changes: []
creates: []
refs:
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts) - the `bot-chat` agent, whose turn ends at once"
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - `chatOf` and the `bot-chats` rows, the pattern for the back sessions"
  - "[code://packages/bot/src/template.ts](../../../../packages/bot/src/template.ts) - `templateOf` and `firstTurn`, which no code calls yet"
  - "[code://packages/sdk/src/types/plugin.ts#L664](../../../../packages/sdk/src/types/plugin.ts#L664) - `registerTool`, for `post_message`"
  - "[code://packages/sdk/src/types/host.ts#L676-L680](../../../../packages/sdk/src/types/host.ts#L676-L680) - `HostTool.run` and its `ToolCall`, which names the calling session"
  - "[code://packages/sdk/src/types/events.ts#L144-L168](../../../../packages/sdk/src/types/events.ts#L144-L168) - `input_needed_set` and `input_needed_removed`, a back session's questions"
  - "[code://packages/sdk/src/host/spawn.ts#L339-L436](../../../../packages/sdk/src/host/spawn.ts#L339-L436) - `openSubagent`, how a call links a worker chat"
  - "[code://packages/sdk/src/host/calllinks.ts#L30](../../../../packages/sdk/src/host/calllinks.ts#L30) - `_meta.toolKind: 'subagent'` makes a call a spawning call"
  - "[code://packages/sdk/src/types/agent.ts#L238](../../../../packages/sdk/src/types/agent.ts#L238) - `Start.instructions`, which Claude and pi append to the system prompt"
  - "[code://packages/webhook/src/plugin.ts#L66-L98](../../../../packages/webhook/src/plugin.ts#L66-L98) - how a plugin dispatches a turn or a steer through its peer"
---

## Goal

A person's main chat with a bot is named `bot:/<bot>/<user>`, and it runs no harness.
Behind it are back sessions, each named `bot:/<bot>/<user>/<name>` and each on the bot's harness.
A message in the main chat goes to a back session as a turn, or as a steer when that session works.
When no back session has the name, the message starts one.
The bot's template says the name, so a bot continues one back session or starts a new one for each message.
The main turn stays open and shows the back session as a subagent call, until the back session calls `post_message`.
A back session's question or approval is shown in the main chat, as a subagent's question is shown in its parent.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- `bot-chat` ends every turn in the call that starts it, so no turn stays open.
- No name addresses a main chat or a back session: a main chat is `bot-chat:/<uuid>`.
- No `post_message` tool.
- A call links only a worker chat in its own session, not a chat in another session.
- Nothing shows one session's question in another chat.
- A session request has no system prompt, so the use of `post_message` cannot reach the harness.
- The plugin writes no file in the bot's folder, and no template asks the owner what the bot is for.
- A session with no turns is gone after a restart, but its owner row stays.
- The bot plugin needs the grants `session:read` and `session:write` on its entry, and the docs do not say so.

## Answers

| What | Source | Task |
| --- | --- | --- |
| No automation: a message in the main chat wakes a back session directly | Softov, 2026-10-16, "automation were not the main idea", then "ok continue" on the corrected model | 03 |
| The main chat is `bot:/<bot>/<user>`, and a back session is `bot:/<bot>/<user>/<name>` | Softov, 2026-10-16, "bot:/{bot}/{user} is the fucking main session for a user", "bot:/{bot}/{user}/xyz for others" | 01 |
| The template says the back session's name, to continue one or start a new one | Softov, 2026-10-16, "the idea is to choise a running session or a new one if desired" | 03 |
| A back session's question or approval goes to its main chat, as a subagent's does | Softov, 2026-10-16, "when a `template session` has a question, it goes to main chat with that session" | 06 |
| The main turn stays open until `post_message`, or ends as `mainTurnPostMessageAbsent` says when the back session's turn ends with no post | Softov, 2026-10-16, chose "Turn stays open"; the option from 2026-10-17 | 02, 04, 13 |
| The open main turn shows the back session as a subagent call, as ahpapp draws one | Softov, 2026-10-16, answered "Working. subagent on top like ahpapp?" for "What does your open turn show while the wake works?" | 05 |
| A back session works in the bot's folder | Softov, 2026-10-16, chose "The bot's folder" | 03 |
| The host's bot rules are a system prompt where possible | Softov, 2026-10-16, chose "System prompt where possible" | 07 |
| The default name is `work`, so a person continues one back session | (defaulted: "its one for user") | 03 |
| A name may hold `{turn}`, which gives a new back session for each message | (defaulted: one word for "a new one if desired") | 03 |
| `<user>` is the id after `user:`, and the host's name for a reader who is nobody | (defaulted: `chatOf` keys on the owner the same way) | 01 |
| A back session is owned by the person of its main chat | (defaulted: the person reads and answers their own back session) | 03 |
| The system prompt is only the use of `post_message`, and the bot's rules are in `AGENTS.md` | Softov, 2026-10-17, chose "AGENTS.md" for "How should a back session get the bot's rules and the instruction to call post_message?" | 07, 10 |
| `post_message` is opt-in, and only a session whose request names it has it | Softov, 2026-10-17, chose "Session asks for it" for "How should post_message be offered only to a bot's back sessions?" | 07 |
| `post_message` replies in the main chat, and `send_message` stays a turn in another session | Softov, 2026-10-17, "post_message is sidebyside with send_message tool right?" | 07 |
| `AGENTS.md` is the persona, read by the harness, and `CLAUDE.md` holds `@AGENTS.md` | Softov, 2026-10-16, chose "AGENTS.md read by the harness" | 10 |
| The bot rewrites its own `AGENTS.md` | Softov, 2026-10-16, "AGENTS.md will need a rewrite right. When bot desires" | 10 |
| The plugin marks only the bot's own folder as trusted | Softov, 2026-10-16, chose "Yes, own folder only" | 10 |
| A plugin asks for trust with `trusted: true` on its request, which trusts only its `workingDirectory`, and the host honours it only with the grant `session:trust` | Softov, 2026-10-17, chose "Request flag + grant" for "How does a bot's back session get trust for its own folder?" | 10 |
| `session:trust` is in the `session` write group, so `session:write` covers it | Softov, 2026-10-17, chose "Keep it in write" for "Every session operation must be in the read or write group, so session:write would cover session:trust. Which way?" | 10 |
| The record's `instructions` is only the seed of the first `AGENTS.md` | Softov, 2026-10-17, chose "Seed only" | 10 |
| ahpd ships a default `AGENTS.md` template at `templates/bots/AGENTS.md` in the config folder, used when a bot names no template, and edited only by hand | Softov, 2026-10-17, "There must be a template default loaded with ahpd. Thats the AGENTS.md template" | 11 |
| The template is the maker: the written `AGENTS.md` tells the bot to ask what it is for and rewrite itself | Softov, 2026-10-17, chose "Template is the maker" for "Does the AGENTS.md template replace task 11's maker?" | 11 |
| The manager text is copied into `AGENTS.md`, so an ahpd update does not change a bot that exists | Softov, 2026-10-16, chose "Copied into AGENTS.md" | 11 |
| "Never does direct work" is a template choice | Softov, 2026-10-16, chose "A template choice" | 11 |
| A session that is gone is started again, because `sessionOwner` answers nothing for it | (defaulted: Softov's test showed `No agent for session` and a main chat that "no longer exists") | 09 |
| A back session that ends its turn with no post closes the main turn as the option `mainTurnPostMessageAbsent` says, with `post` as the default | Softov, 2026-10-17, "Configurable as a host config key. default to post the final text" | 13 |
| A bot's back session loads no settings of the person who runs the daemon, by the request flag `userSettings: false` | Softov, 2026-10-17, chose "Request flag" for "How should a bot session stop loading them?" | 12 |
| A bot asks a question with its harness's question tool, so the question shows in the main chat | Softov, 2026-10-17, chose "Ask with the tool" | 14 |
| Data that changes for each message goes in a context block in front of the woken message, not in the system prompt | Softov, 2026-10-17, chose "Plan it" for "Should I plan the per-message context block as p3 task 15?" | 15 |
| `post_message` runs without asking, by a flag on the host tool that each backend honours; a deny list still wins | Softov, 2026-10-17, chose "Flag on the host tool" for "How should a bot's back session run post_message without asking?" | 16 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A main chat and its back sessions have names](task-01-a-main-chat-and-its-back-sessions-have-names.md) | done | - |
| [02 - A main turn stays open](task-02-a-main-turn-stays-open.md) | done | - |
| [03 - A message wakes a back session](task-03-a-message-wakes-a-back-session.md) | done | 01, 02 |
| [04 - post_message ends the main turn](task-04-post-message-ends-the-main-turn.md) | done | 03 |
| [05 - The main turn shows the back session as a subagent](task-05-the-main-turn-shows-the-back-session.md) | done | 03 |
| [06 - A back session's question is asked in the main chat](task-06-a-back-sessions-question-is-asked-in-the-main-chat.md) | done | 05 |
| [07 - The use of post_message is the system prompt](task-07-the-bots-rules-are-the-system-prompt.md) | done | 03 |
| [08 - The docs say how a bot wakes](task-08-the-docs-say-how-a-bot-wakes.md) | done | 04, 05, 06, 07, 09, 10, 11, 12, 13, 14, 15, 16 |
| [09 - A session that is gone is started again](task-09-a-session-that-is-gone-is-started-again.md) | done | 03 |
| [10 - A bot's folder has its AGENTS.md](task-10-a-bots-folder-has-its-agents-file.md) | done | 03 |
| [11 - The AGENTS.md template makes the bot](task-11-the-owners-first-wake-makes-the-bot.md) | done | 10 |
| [12 - A bot session loads no user settings](task-12-a-bot-session-loads-no-user-settings.md) | done | 10 |
| [13 - A turn with no post has a set ending](task-13-a-turn-with-no-post-has-a-set-ending.md) | done | 04 |
| [14 - A bot asks with the question tool](task-14-a-bot-asks-with-the-question-tool.md) | done | 06 |
| [15 - A woken message carries its context](task-15-a-woken-message-carries-its-context.md) | done | 03 |
| [16 - post_message runs without asking](task-16-post-message-runs-without-asking.md) | done | 04 |

## Risks and tradeoffs

- A host can hold thousands of back sessions. They are ordinary sessions, so the session list shows them.
- ACP takes no system prompt, so an ACP bot gets its rules in the first message of a back session.

## Resume state

- **Done so far:** planned 2026-10-16. Tasks 01 to 04, 07 and 09 are on main. Task 10 is implemented. A plugin asks for trust with `trusted: true` on its session request. The host refuses it without `session:trust`, which `session:write` covers. The store keeps the trusted folder, so a restart keeps it. `trustedBy` trusts that one folder and no folder under it. Task 11 is implemented. At load, the plugin writes `<configDir>/templates/bots/AGENTS.md` when the file is absent, never over one a person edited. A bot's first wake fills the template it names, or that default file, with `name`, `description` and `instructions`. The result is the bot's `AGENTS.md`. The shipped text is the maker, so a bot with no instructions gets a file too. Before a back session starts, the bot writes `CLAUDE.md` and `AGENTS.md` when each is absent. Task 13 is implemented. When a back session's turn ends without a post, the plugin reads the turn's `markdown` parts from the session's chat. The main turn then ends as `mainTurnPostMessageAbsent` says. The default is the last words. A value outside those four is reported through `host.problem` and `post` is used. Task 12 is implemented. A request can say `userSettings: false`. The host keeps it with the session and puts it on `Start` at every spawn. Claude then removes `user` from `settingSources`. A trusted folder keeps `project` and `local`, and a folder with no trust loads no settings file. A bot's back session sets the flag. Task 15 is implemented. Each message that wakes a back session has a `<context>` block in front of the person's words. The block says the main chat `bot:/<bot>/<user>`, the person, and the time in the host's own offset. The block is `contextBlock` in `packages/bot/src/context.ts`, and the main chat keeps the plain text the person typed. Task 05 is implemented. The open main turn shows the back session as a `subagent` tool call. `working(chat, title)` on the turn handle starts that call. The call names the back chat in `_meta.subagentChatUri` and in its `subagent` content. `spawn.ts` and the call index keep a link to a chat of another session. A worker chat in the same session keeps its derived URI. Task 06 is implemented. The plugin copies a back session's request into the open main turn. An approval shows as a tool call in `pending-confirmation`, and a question shows as an `inputRequest` part. `ask.ts` sends the answer to the back session's chat as `chat/toolCallConfirmed` or `chat/inputCompleted`. On `input_needed_removed`, the plugin removes the copy and tells live clients that it is over. Task 14 is implemented. `POST_INSTRUCTION` tells a back session to ask with its harness's question tool. A harness with no question tool asks in the text it posts. No tool is named, because each harness names its own. Task 16 is implemented. A `HostTool` may say `confirm: false`. The bind carries it on `BoundTool`. In agent-claude, `canUseTool` allows a contributed tool with that flag without asking. The deny list still refuses it. `post_message` sets it. `agent-pi` and `agent-cofold` ask from `effects`, and `post_message` declares none, so neither asks; `agent-acp` asks only when its server asks. A bot's back session in the default mode posts with no approval. Task 08 is implemented. `docs/plugins/BOTS.md` and `packages/bot/README.md` say what a main chat and its back sessions are, with the two names. They say how `session` picks a back session, with `work` and `{turn}` as examples. They say what `post_message` and a turn end with no post do. They say how a question is answered in the main chat, and that `AGENTS.md` is the bot's rules. Both name the entry's grants, `session:read` and `session:write`, and `PLUGINS.md`'s bot example names both.
- **Next action:** none. The plan is built. The by-hand run in ahpw moved to [the bot chat plan](../20261103-0158-a-bot-chat-follows-its-back-session/plan.md), which changes the same path.
- **Open questions:** none.
- **Watch out for:** a request's `instructions` are not kept, so a session started again after a restart is not told them. A rule that must hold for the whole session goes on a tool's `instruction`.
- **Watch out for:** `post_message` finds its main chat from the calling session, never from an input, so a back session cannot post as another bot.
- **Watch out for:** `confirm: false` is read by agent-claude. `agent-pi` and `agent-cofold` ask from a tool's `effects`, and they ignore the flag. `agent-acp` asks when its server asks, and the flag does not reach it.
- **Watch out for:** the opt-in names are in `SessionStore.tools`, not in the session config. `openSession` gets `backendsOwn(config)`, which removes a host key before `setConfig`.
- **Watch out for:** `userSettings` is kept beside the opt-in tools, and only as `false`: absent is the default every session has always had. `spawn` reads it off the store, so a restart keeps it without the request.
- **Watch out for:** the bot plugin's entry needs `session:trust` beside `session:read` and `session:write`. Without it every wake is refused with an error naming the grant. A grant group covers it: `session:write` and `session:*` both hold `session:trust`.
- **Watch out for:** p2's main chat is a `bot-chat:/<uuid>` session. Task 01 gives it the name `bot:/<bot>/<user>`, and the session URI stays as it is.
- **Watch out for:** a name a message fills is checked with `isFilledName`, not `isSlug`. A turn id is a uuid, so the filled name may start with a digit and is at most eighty characters.
- **Watch out for:** a bot's `AGENTS.md`, once written, is the bot's. The template and the record's `instructions` are not read again for it. An edit to `<configDir>/templates/bots/AGENTS.md` changes the next bot made, and no bot that exists.

## Final verification checklist

- [x] A test: a message in a main chat starts a back session, and a second message is a turn in the same one. (`packages/bot/test/bot-wake.test.ts`, by task 03)
- [x] A test: a name with `{turn}` starts a new back session for each message. (`packages/bot/test/bot-wake.test.ts`, by task 03)
- [x] A test: `post_message` ends the main turn with its text, and a back session cannot post into another chat. (`packages/bot/test/bot-post.test.ts`, by task 04)
- [x] A test: a back session's question is answered from the main chat. (`packages/bot/test/bot-ask.test.ts`, by task 06)
- [x] The gates pass: build, typecheck, boundary, schema and vitest.
- [ ] By hand: in ahpw, a message to a bot gets a reply, and the subagent call opens the back session. (Moved to the final checklist of [the bot chat plan](../20261103-0158-a-bot-chat-follows-its-back-session/plan.md).)
- [x] `docs/plugins/BOTS.md` and `plans/index.md` updated.
