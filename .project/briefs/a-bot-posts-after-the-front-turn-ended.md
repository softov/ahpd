---
title: A bot posts after the Front turn ended
created: 2026-11-13
refs:
  - git://d9fbae5b3 - main when the facts were checked
  - "[code://packages/bot/src/post.ts#L87](../../packages/bot/src/post.ts#L87) - `post_message` refuses where `wake.posted` finds no waiting Front turn"
  - "[code://packages/bot/src/wake.ts#L550-L558](../../packages/bot/src/wake.ts#L550-L558) - `posted` adds the text to the Front turn the Back chat answers, in the bot-talk branch"
  - "[code://packages/bot/src/wake.ts#L457-L473](../../packages/bot/src/wake.ts#L457-L473) - `finished` lets go of the Front turn when the Back's turn ends"
---

# A bot posts after the Front turn ended

Softov wants a bot to post into its Front after the turn that woke it has ended. An example is a timer that posts every 15 seconds.
He asked Ember (2026-11-13): "Can you ran it on background? Make it ran a timer, and post_message".

## What ahpd does today

- `post_message` adds its text to the Front turn that the Back chat answers.
- The wake holds that Front turn from the message until the Back's turn ends. Then `finished` lets go of it, and the Front turn ends.
- A post with no waiting Front turn is refused: "There is no main chat waiting on this chat, so there is nothing to post to."
- A Claude subagent started with `run_in_background` runs on after the Back's turn ends. Its posts come after the Front turn ended, so each one is refused.
- When the subagent ends, the CLI starts a Back turn of its own. No Front turn waits on it, so its posts are refused too.
- A question asked in that Back turn is not copied to the Front either. It shows in the Back chat and on the session's `inputNeeded` (Softov's session `07f63bcf`, 2026-11-13).
- A subagent's `post_message` names the Back chat: the host binds the tools once for the CLI process, under the chat that started it.

## Open questions

- What a late post is in the Front: a new turn the bot opens, or a part added to the last turn.
- Whether a question or an approval from a Back turn that no Front message started opens a Front turn too.
- How a client shows a turn that no message from the person started.
- How the webhook and the connectors deliver a post that answers no request.
- Whether a late post needs a limit, so a loop in the Back cannot fill the Front.
