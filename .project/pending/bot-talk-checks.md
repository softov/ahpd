---
title: Check a talk with a bot, its Back chat and a restart
plans:
  - plans/bots/20261113-0817-a-bot-talk-is-one-session-with-back-chats/plan.md
  - plans/host/20261113-0817-a-plugin-chat-has-an-origin-and-tools/plan.md
  - plans/host/20261113-0817-an-agent-sets-a-new-sessions-folder/plan.md
---

# Check a talk with a bot, its Back chat and a restart

The tests cover each part, but no test restarts a daemon or draws the Back in a client. Run these after the merge, on the test daemon: `source .project/pending/test-daemon.sh bot agent-claude`. Give the bot plugin's entry `"grants": ["session:read", "session:write"]`, as BOTS.md prints it. Set `users` in the test daemon's config: a bot does not answer on a host with no users, as [the problem](../problems/a-bot-never-answers-on-a-host-with-no-users.md) says.

## One talk, and the Back as a subagent

1. Make a bot Ello on the `claude` provider, then open it from the bot page in ahpw.
2. Send `hello`. Pass: the Front turn shows one `subagent` call, and ahpw lists a chat named Ello under it in the same session. Fail: a second session appears in the session list.
3. Open the bot page again. Pass: ahpw opens the same session. Fail: a new empty session.
4. In VS Code, make a second `bot-chat` session with Ello. Pass: the create fails with `You already have a session with Ello: <uri>.`, and that session is in VS Code's list.
5. Type a message in the Back chat itself. Pass: the reply stays in the Back, and the Front shows no new turn.

## A reader without bot:chat

1. Give a second user `bot:get` and not `bot:chat`, and sign in as them.
2. Make a `bot-chat` session with Ello. Pass: it fails with `There is no bot ello.`

## A restart during a reply

1. Send Ello a message that takes a while, such as `count to 200 slowly, then post the total`.
2. While the Back works, stop the test daemon with `ahpd stop`, and start it again with the same command.
3. Pass: the Front turn is open again after the start, without opening the talk, and the bot's reply lands in that turn. Fail: the turn reads back as interrupted, or no reply comes.

## The webhook

1. Make a webhook endpoint for Ello and call it from two threads, `pr-1` and `pr-2`.
2. Pass, with `threadSessions` absent: one session with two Front chats, each with its own Back chat.
3. Set `"threadSessions": true` on the webhook entry, restart, and call from a new thread `pr-3`. Pass: `pr-3` has a session of its own.
