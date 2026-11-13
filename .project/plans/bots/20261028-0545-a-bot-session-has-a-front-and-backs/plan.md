---
title: A bot session has a Front, Backs and wakes
domain: bots
status: draft
priority: medium
created: 2026-10-22
revalidated: 2026-10-28
requires:
  - plans/plugin/52-p3-a-message-wakes-the-bot-and-it-replies/plan.md
  - plans/host/107-a-chat-is-served-by-a-backend-of-its-own/plan.md
changes:
  - specs/bots.md
creates: []
refs:
  - "[code://packages/bot/src/wake.ts#L221-L234](../../../../packages/bot/src/wake.ts#L221-L234) - `sessionFor`, the request a Back session is started from today; it sets no permission mode"
  - "[code://packages/bot/src/wake.ts#L323-L392](../../../../packages/bot/src/wake.ts#L323-L392) - `sessionNamed`, one Back session for each bot, person and name"
  - "[code://packages/bot/src/chat.ts#L450](../../../../packages/bot/src/chat.ts#L450) - `botChatAgent`, the provider of the Front"
  - "[code://packages/bot/src/post.ts#L44-L89](../../../../packages/bot/src/post.ts#L44-L89) - `post_message`, which posts only to the Front that woke the Back"
  - "[code://packages/bot/src/context.ts](../../../../packages/bot/src/context.ts) - `contextBlock`, the shape the wake templates keep"
  - "[code://packages/bot/src/template.ts#L85-L106](../../../../packages/bot/src/template.ts#L85-L106) - the shipped `AGENTS.md` template, the pattern the wake templates copy"
  - "[code://packages/sdk/src/types/triggers.ts#L24](../../../../packages/sdk/src/types/triggers.ts#L24) - the `childFinished` event kind"
  - "[code://packages/sdk/src/host/sessionevents.ts#L160-L171](../../../../packages/sdk/src/host/sessionevents.ts#L160-L171) - the host emits `childFinished` on the parent session"
  - "[code://packages/sdk/src/tools/session.ts#L446](../../../../packages/sdk/src/tools/session.ts#L446) - `create_session`, whose relationship decides the parent"
  - "[code://packages/sdk/src/host/routing.ts#L46](../../../../packages/sdk/src/host/routing.ts#L46) - a chat session is routed like any session, so VS Code lists it"
  - "[code://docs/sdk/SESSIONS.md](../../../../docs/sdk/SESSIONS.md) - session grants are by role, and a session has no member list"
  - "[code://.project/plans/plugin/52-p4-a-group-chat-has-members-and-mentions/plan.md](../../../../.project/plans/plugin/52-p4-a-group-chat-has-members-and-mentions/plan.md) - dropped draft merged here: group chats"
  - "[code://.project/plans/plugin/52-p6-a-bot-wakes-when-a-session-it-started-finishes/plan.md](../../../../.project/plans/plugin/52-p6-a-bot-wakes-when-a-session-it-started-finishes/plan.md) - dropped draft merged here: the finished-session wake"
  - "[code://.project/plans/plugin/52-p9-front-and-back-are-chats-of-one-session/plan.md](../../../../.project/plans/plugin/52-p9-front-and-back-are-chats-of-one-session/plan.md) - dropped draft merged here: Front and Back"
  - "[code://.project/plans/plugin/52-p11-a-bot-has-a-private-session/plan.md](../../../../.project/plans/plugin/52-p11-a-bot-has-a-private-session/plan.md) - dropped draft merged here: the private session and the wake templates"
  - "[code://.project/plans/plugin/52-p14-a-bot-session-has-a-front-and-backs/plan.md](../../../../.project/plans/plugin/52-p14-a-bot-session-has-a-front-and-backs/plan.md) - the draft this plan replaces"
---

## Goal

One person's talk with a bot is one session with a Front chat and one or more Back chats.
Each bot also has one private session, where no person chats, and every wake with no person behind it goes there.
A group chat has members, and `@<slug>` in it wakes that bot's private session after a delay.
A session that a bot started wakes the bot when it finishes.
A Back asks for no approval by default.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
This plan merges the drafts p4, p6, p9, p11 and the permission mode of p7, because each one rewrites `wake.ts`, `chat.ts` and `post.ts`.

### Searches performed

- `rg -n "backs\." packages/bot/src` - the plugin keeps a row for each Back session, keyed by bot, person and name.
- `rg -n "permissionMode" packages/bot/src` - `sessionFor` sets no mode.

### Runtime path

```
person -> Front chat (bot-chat provider, no model) -> wake -> Back chat of the same session (a harness) -> post_message -> Front
@ello in a group -> wait the delay -> wake template -> Ello's private session -> post_message to the group
automation | childFinished -> wake template -> the bot's private session -> post_message to the chat it names
```

### Gaps

- A Back is a session of its own, with no link to the Front in the protocol, and the session list shows two unrelated rows.
- A chat of a session cannot be served by a harness, which host/107 adds.
- A wake with no person behind it starts a new session for each fire.
- The wake instructions are text in the code, and an owner cannot change them.
- A session has no member list, and a bot cannot make a group chat or post to one.
- No bot listens to `childFinished`, and an `independent` session from `create_session` may have no parent.
- `sessionFor` sets no permission mode, so a Back starts in the harness default and waits for an approval nobody sees.

## Answers

| What | Source | Task |
| --- | --- | --- |
| One plan for the session model and its wakes | Softov, 2026-10-22, chose "Merge four + p7 mode" | - |
| A person's Front and Back are one session with two chats, and the bot provider owns the session | Softov, 2026-10-18, chose "Bot provider owns it" | - |
| The chat where the person talks to the bot is the Front, and the harness chat is the Back | Softov, 2026-10-18, "Lets call the part where we send message to the bot Front. and with harness the Back." | - |
| A Back chat can use another harness than another Back chat | Softov, 2026-10-18, "even another harness on another chat, right?" | - |
| Each bot has one private session, where no person chats, and only system instructions and wake automations send to it | Softov, 2026-10-18, "each bot will have its own private session.. no one can chat on it.. only system instructions or wake automations." This replaces "No, new per fire" of 2026-10-16 | - |
| A group chat is a session with no model, with members on it, and VS Code can chat in it | Softov, 2026-10-16, chose "Members on the chat session"; 2026-10-18, "each group will have a session too no model" | - |
| Only `@<slug>` wakes a bot in a group | Softov, 2026-10-16, chose "Only @backer" | - |
| A person and a bot can make a group chat and send a message to it | Softov, 2026-10-18, chose "Group create and post" | - |
| A mention waits a delay, then wakes the bot's private session with the group's URI and its last messages | Softov, 2026-10-18, "When someone mention a bot on a group call. it wait X seconds and make a wake on that bot." | - |
| Each wake instruction is a template in `<configDir>/templates/bots/`, shipped as a default like `AGENTS.md` | Softov, 2026-10-18, "we need examples of those instructions on /home/softov/.config/ahpd/templates" | - |
| The default text of each wake template is in the code, and the plugin writes the file at load or when needed, if it does not exist | Softov, 2026-10-18, "Those templates need to be installed with the ahpd if not existed." | - |
| A session that a bot started wakes the bot's private session when it finishes | Softov, 2026-10-16, p6's goal, with the private session of 2026-10-18 | - |
| A Back's permission mode comes from the bot, then a host option, then `auto` | Softov, 2026-10-18, chose "Bot permission mode" | - |

## Tasks

Not written yet.

## Risks and tradeoffs

- A group message is text from people the owner may not trust - the mention template says so, and the tools refuse it too.
- The tasks name security tests for a group message.
- The Front's history must outlive a change of the Back's harness, because the Front is the bot provider's chat.
- Two sessions that finish together give two wakes, not one lost wake.

## Resume state

- **Done so far:** moved from plugin/52 p14 on 2026-10-28, when Softov made the `bots` domain. It was merged 2026-10-22 from the plugin/52 drafts p4, p6, p9, p11 and the permission mode of p7. Example templates are in `~/.config/ahpd/templates/bots/`: `wake-mention.md` and `wake-automation.md`.
- **Moved out on 2026-11-13:** a person's direct talk, its Back chats and the webhook went to [bots/20261113-0817-a-bot-talk-is-one-session-with-back-chats](../20261113-0817-a-bot-talk-is-one-session-with-back-chats/plan.md). This plan keeps groups, the private session, automations and the finished-session wake.
- **Next action:** build bots/20261113-0817-a-bot-talk-is-one-session-with-back-chats, ask the open questions, then write the tasks. That plan answers two earlier questions: the Back sessions that exist stay as they are, and a Back chat is `full`.
- **Open questions:**
  1. Is the private session a bot provider session with Back chats and no Front - proposed: yes.
  2. The delay before a mention wakes the bot - proposed: 10 seconds, and a new mention in that time restarts the wait.
  3. How many messages a wake gives - proposed: the last 20, set by a plugin option.
  4. Who may add a member to a group - proposed: the chat's owner.
  5. May a bot read a group where nobody mentioned it - proposed: no, a wake gets the last messages the template names.
  6. How a bot names the group to post to - proposed: a `chat` argument on `post_message`, limited to groups where the bot is a member.
  7. How a finished-session wake knows the chat to post to - proposed: the task names the chat.
  8. A harness with no `auto` mode - proposed: the bot names the harness's own value, and an unknown value uses the default.
- **Watch out for:** read how an `independent` session records its creator before the `childFinished` task.

## Final verification checklist

- [ ] Maria and Pedro talking to Ello are two sessions, each with a Front and a Back, and a client shows the Back beside the Front.
- [ ] `@ello` in a group wakes Ello's private session after the delay, and Ello posts back to the group.
- [ ] A session that Ello started wakes Ello when it finishes.
- [ ] A Back starts with no approval waiting.
- [ ] `specs/bots.md`, `docs/plugins/BOTS.md` updated.
