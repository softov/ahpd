---
title: A bot chat follows its back session
created: 2026-11-02
refs:
  - git://f419294d - the commit of this repository the facts were checked at
  - git://15f02030 - the commit the facts in *What #193 changed* were checked at
  - "[code://packages/bot/src/chat.ts#L650-L653](../../packages/bot/src/chat.ts#L650-L653) - `withdrawAsked`, which since #193 only removes the request from the open turn's list"
  - "[code://packages/bot/src/chat.ts#L1092-L1116](../../packages/bot/src/chat.ts#L1092-L1116) - the two answers from the bot chat, which carry `turnId`"
  - "[code://packages/bot/src/ask.ts#L199-L206](../../packages/bot/src/ask.ts#L199-L206) - `withdrawn`, called when the back session stops asking"
  - "[code://packages/bot/src/plugin.ts#L512-L522](../../packages/bot/src/plugin.ts#L512-L522) - `look`, which reads `working` from the session's `status`"
  - "[code://packages/bot/src/wake.ts#L531-L577](../../packages/bot/src/wake.ts#L531-L577) - the wake, which steers when `working` is true and shows the refusal as a notice"
  - "[code://packages/sdk/src/host/chatactions.ts#L1484-L1499](../../packages/sdk/src/host/chatactions.ts#L1484-L1499) - a steer with no turn running runs as a turn of its own, since #193"
  - "[code://packages/agent-claude/src/session/turns.ts#L668-L669](../../packages/agent-claude/src/session/turns.ts#L668-L669) - Claude's `steer`, false when no turn is active"
  - "[code://packages/sdk/src/host/catalogue.ts#L469-L481](../../packages/sdk/src/host/catalogue.ts#L469-L481) - `drivingOf`, the session status made from its chats"
  - "[code://packages/bot/src/post.ts#L41](../../packages/bot/src/post.ts#L41) - `POST_INSTRUCTION`, which tells every turn that a person waits in the main chat"
  - "[code://packages/bot/src/post.ts#L80-L88](../../packages/bot/src/post.ts#L80-L88) - `post_message`, which refuses a session that no open wake waits on"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `updateToolCallInParts` in `types/channels-chat/reducer.ts`, which ignores a tool call action whose `turnId` is not the active turn
---

# A bot chat follows its back session

Softov wants the bot chat to show what the back session does.
An answer that a person gives on the back session clears the copy in the bot chat.
A message that a person sends after the back session's turn ended starts a new turn there, and is not refused as a steer.

## What happened

Softov reported this on 2026-11-02, with the bot `gumbo`.
The back session is `claude:/032ec6cb-e3a6-423f-a22d-f2ba9bc4709a` and the bot chat is `bot-chat:/d49224a1-9b90-4cb6-a9c6-738e77882ec0`.
The times come from the Claude transcript of the back session and the bot chat's log, in UTC.

| Time | What happened |
|---|---|
| 22:42:41 | The bot chat turn `e7e77070` starts and wakes the back session. |
| 22:42:58 | The back session asks to run a `Bash` command. The bot chat shows a copy of the request. |
| 22:43:15 | Softov approves on the back session. The command runs. |
| 22:45:31 | The back session calls `post_message`, and the bot chat turn ends. |
| 22:45:38 | The back session's turn ends. |
| 22:47:43 | Softov sends "yes, write it". The bot chat turn `3a0ef3e7` ends in 36 ms with "Gumbo was not woken: Nothing is running in this chat to steer". |
| 23:01:37 | Softov sends "yes, write it" again. The bot chat turn `7132d012` ends with the same notice. |

After this, the bot chat still shows the request as pending.
The back session shows a "Steering" message with the context block of the last send, and Claude never got it.
After a reload of the page, the back session shows no "Steering" message, and Claude did not act on it.
Each message stays in the bot chat as a turn with only the notice.

## What others do

The protocol is the reference, at `@microsoft/agent-host-protocol` 1.0.0.

- `chat/toolCallConfirmed` carries `turnId` and `toolCallId`, both required.
- The reducer changes a tool call only when `turnId` is the id of the chat's active turn. Otherwise it returns the state unchanged.
- A `steering` pending message "is injected into the current turn mid-flight". A `queued` one starts a new turn after the current turn ends.

## What ahpd has today

### The copy stays pending

- When the back session stops asking, `withdrawn` in [`code://packages/bot/src/ask.ts`](../../packages/bot/src/ask.ts#L199-L206) calls `withdrawAsked`.
- [`withdrawAsked`](../../packages/bot/src/chat.ts#L650-L674) removes the part from the bot chat's state and sends `chat/toolCallConfirmed` with `approved: false` and `reason: 'skipped'`.
- That action has no `turnId`, so a client's reducer ignores it and keeps the call in `pending-confirmation`.
- The two answers from the bot chat itself carry `turnId: held.id`, at [`code://packages/bot/src/chat.ts#L1092-L1116`](../../packages/bot/src/chat.ts#L1092-L1116).
- The final record of turn `e7e77070` has no confirmation part. So the host state dropped it, and only a live client kept it.
- `chat/inputCompleted` names only `requestId`, so a withdrawn question is not affected.

### The message is sent as a steer

- [`look`](../../packages/bot/src/plugin.ts#L512-L522) subscribes to the back session and reads `working` from the `InProgress` bit of the session's `status`.
- The wake sends `chat/pendingMessageSet` with kind `steering` when `working` is true, and `chat/turnStarted` otherwise, at [`code://packages/bot/src/wake.ts#L565`](../../packages/bot/src/wake.ts#L565).
- The host refuses the steer when the backend's `steer` returns false, at [`code://packages/sdk/src/host/chatactions.ts#L1428`](../../packages/sdk/src/host/chatactions.ts#L1428).
- Claude's `steer` returns false when it has no active turn, at [`code://packages/agent-claude/src/session/turns.ts#L669`](../../packages/agent-claude/src/session/turns.ts#L669).
- On a refusal the wake shows the notice and does not try again, at [`code://packages/bot/src/wake.ts#L577`](../../packages/bot/src/wake.ts#L577).
- So at 22:47:43 and again at 23:01:37 the session's `status` had the `InProgress` bit, and Claude had no active turn. The bit stays set, and each new message is refused.
- The session `status` comes from its chats in [`drivingOf`](../../packages/sdk/src/host/catalogue.ts#L469-L481). A chat that asks gives `InputNeeded`, which holds the `InProgress` bit.
- The back session has one chat and no worker chat. The transcript has no `Agent` call.
- The stored flags of the back session are `32`, which is `IsRead`, not `InProgress`.

### A turn started on the back session

Softov saw this on 2026-11-02: he sent "yes, write it" on the back session itself, and the back session ran it.
The bot chat showed no running state and no thinking while that turn ran.

- The bot chat shows the back session as working only from the wake, at [`code://packages/bot/src/wake.ts#L562`](../../packages/bot/src/wake.ts#L562).
- `working` acts only while a bot chat turn is open, at [`code://packages/bot/src/chat.ts#L772-L776`](../../packages/bot/src/chat.ts#L772-L776).
- The bot plugin listens to `turn_end` of a back session, at [`code://packages/bot/src/plugin.ts#L583`](../../packages/bot/src/plugin.ts#L583). It does not listen to `turn_start`.

### The reply of a turn started on the back session

Softov saw this on 2026-11-02, with the bot `gumbo`, in the same turn.

| Step | What happened |
|---|---|
| 1 | The back session called `post_message` with its report. The answer was "There is no main chat waiting on this session, so there is nothing to post to." |
| 2 | The back session called `send_message` to `bot-chat:/d49224a1-9b90-4cb6-a9c6-738e77882ec0`, with the report and an instruction to post it as it is. |
| 3 | That message started a bot chat turn, which woke the back session again. |
| 4 | In the new turn, `post_message` posted the report to the bot chat. |

- [`post_message`](../../packages/bot/src/post.ts#L80-L88) asks the wake for the session's open wake. A turn that a person started on the back session has none, so the tool refuses.
- [`POST_INSTRUCTION`](../../packages/bot/src/post.ts#L41) goes with the tool to every turn. It says that a person waits in the main chat, and that `send_message` does not reply. In a turn started on the back session, both statements are false.
- So the back session found the reply path through `send_message` itself. The bot chat shows the report as the reply to a message that the back session sent, not to a message of the person.

### What #193 changed

MayCXC's union, merged as PR #193 at git://8a59f843, changed three of the facts in this section.

| Commit | What it does now |
|---|---|
| git://90efda43 | [`withdrawAsked`](../../packages/bot/src/chat.ts#L650-L653) sends nothing. The copy stays in the bot chat's turn, and the turn's end shows it as skipped. The commit follows VS Code's host, which sends no completion that no client sent. |
| git://a3662128 | A steer with no turn running is no longer refused. The host runs it as a turn of its own, under its id ([`code://packages/sdk/src/host/chatactions.ts`](../../packages/sdk/src/host/chatactions.ts#L1484-L1499)). |
| git://84e9c0b5 | After each chat action, the host removes each `inputNeeded` entry of that chat that no longer stands, and every entry once no turn runs. This is a likely fix of the `InProgress` bit that stayed. No test daemon checked it yet. |

## Who writes

- Another session works in `/github/ahpd` on `main`. It writes `.project/working/HANDOFF.md`.
- MayCXC's union is merged into `main` through PR #193. Clearing the copy at once reverts part of git://90efda43, so MayCXC sees the reason in the PR.
- The plan [56-a-steered-bot-message-is-its-own-turn](../plans/plugin/56-a-steered-bot-message-is-its-own-turn/plan.md) built the steer path in the bot chat. git://ca82b8af changed it: a steer goes into the open turn. This change keeps that.

## The change

- When the back session stops asking, `withdrawAsked` sends `chat/toolCallConfirmed` with the `turnId` of the open turn, as the bot chat's own answers do. The copy clears at once.
- A test checks that a client's reducer marks the withdrawn call as `cancelled`.
- The wake does not change. The host runs a late steer as a turn since #193.
- A turn that starts on the back session opens a turn of its own in the bot chat. It shows running, with the back session's activity, until the back turn ends.
- In that turn, `post_message` posts into the bot chat's turn. The tool's instruction tells the truth for that turn.

## Answers

| What | Source |
|---|---|
| The copy of a question that the back session no longer asks clears at once, with the open turn's `turnId` | Softov, 2026-11-02, chose "Clear it at once" after #193 |
| The wake keeps no fix of its own. The host's run of a late steer as a turn covers both fixes | Softov, 2026-11-02, chose "Drop both" after #193 |
| A turn that starts on the back session opens a turn of its own in the bot chat, and the back session's answer lands there | Softov, 2026-11-02, chose "A turn of its own" |
| `post_message` in that turn posts into it | (defaulted: the turn of the bot chat is where its answer lands) |

## Open points

- Whether a message sent after the back session's turn ended now starts a turn there. This needs a test daemon that repeats the 22:47:43 send.
- Whether git://84e9c0b5 clears the `InProgress` bit after an approval on the back session. This needs the same test daemon.
- Which part kept the "Steering" message until a reload. git://a3662128 may remove the cause. This needs the same test daemon.
