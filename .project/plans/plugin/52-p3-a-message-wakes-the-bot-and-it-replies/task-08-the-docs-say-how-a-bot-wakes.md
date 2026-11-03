---
title: The docs say how a bot wakes
status: done
depends: [task-04-post-message-ends-the-main-turn.md, task-05-the-main-turn-shows-the-back-session.md, task-06-a-back-sessions-question-is-asked-in-the-main-chat.md, task-07-the-bots-rules-are-the-system-prompt.md, task-09-a-session-that-is-gone-is-started-again.md, task-10-a-bots-folder-has-its-agents-file.md, task-11-the-owners-first-wake-makes-the-bot.md, task-12-a-bot-session-loads-no-user-settings.md, task-13-a-turn-with-no-post-has-a-set-ending.md, task-14-a-bot-asks-with-the-question-tool.md, task-15-a-woken-message-carries-its-context.md, task-16-post-message-runs-without-asking.md]
layer: "docs"
refs:
  - "[code://docs/plugins/BOTS.md](../../../../docs/plugins/BOTS.md) - the bot docs"
  - "[code://packages/bot/README.md](../../../../packages/bot/README.md) - the package readme"
---

## Objective

The docs say what a main chat and a back session are, and how a message reaches a back session.
They name `bot:/<bot>/<user>`, `bot:/<bot>/<user>/<name>`, the `session` field and `post_message`.

## Files

- `UPDATE: docs/plugins/BOTS.md` - the main chat, the back sessions, `session`, `post_message` and the questions.
- `UPDATE: packages/bot/README.md` - the same, in short.
- `UPDATE: docs/plugins/PLUGINS.md` - the bot entry's example grants name `session:read` beside `session:write`.

## Steps

1. Add a section on the main chat and its back sessions, with the two names.
2. Say how `session` picks a back session, with `work` and `{turn}` as examples.
3. Say that `post_message` ends the main turn, and what a turn end with no post does.
4. Say that the person answers a back session's question in the main chat.
5. Say that `AGENTS.md` is the bot's rules, and that the owner's first wake makes it.
6. List the grants the bot plugin needs on its entry: `session:read` and `session:write`.
7. Run `pnpm -s docs:build`.

## Validation

- `pnpm -s docs:build` passes.
