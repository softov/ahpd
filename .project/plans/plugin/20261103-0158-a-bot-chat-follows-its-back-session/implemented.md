---
title: A bot chat follows its back session - implemented
date: 2026-11-03
refs:
  - git://6a474552
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts)"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts)"
---

A person who uses a bot now sees the bot's work in the main chat, also when the work did not start there. A turn typed in the back session opens a turn of its own in the main chat. That turn shows the back session as the call it waits on, and the back session's answer ends it. A request that the back session stops asking about leaves the main chat at once. It ends as a cancelled question or a skipped call, and is not left drawn with nobody to answer it.

## What was built

- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `TurnHandle.begin(text, from?)` opens a turn that nobody in the chat said, and answers its id. It answers nothing while a turn is open. `beginTurn` opens a turn without answering it, and `beginMessage` hands a message's turn to `onMessage`. `withdrawAsked` removes a withdrawn request from the open turn and says the end. A question ends with `chat/inputCompleted` and `response: 'cancel'`. A call ends with `chat/toolCallConfirmed`, `approved: false` and `reason: 'skipped'`.
- [`code://packages/bot/src/names.ts`](../../../../packages/bot/src/names.ts) - `BackSessions.of(bot, session)` answers the row a session is named by, which is the other direction of `get`.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - `Wake.began` holds a main turn open on a back turn that the wake did not start. It sets the `answering` entry and shows the back chat as the call. It also sets the `begun` clock that a stop is measured by.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - a `turn_start` listener opens the main turn for a back session's turn. It finds the main chat from the back row and the owner's one main chat. It leaves alone a session the wake already holds, a chat this host is not running, and a chat with a turn open.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - a back turn can end while the `turn_start` listener still reads the rows and the back chat. The listener keeps a note for each back turn it reads, and `turn_end` stores its event on that note. After `began`, the listener ends the main turn with that event, as `turn_end` ends any other.

## Verified

- `pnpm --filter @ahpd/bot test`, run alone: 208 tests in 15 files pass.
- `bot-chat.test.ts`: a `turn_end` that arrives before the `turn_start` listener opens the main turn still ends that turn. The turn shows the back chat as a completed call and the back turn's text. The case fails on the code before this fix, where the main turn stays open.
- `bot-chat.test.ts`: `begin` opens a turn, leaves it open, tells no listener, and answers `undefined` while a turn is open. The protocol's reducer replays the actions of a withdrawal. A withdrawn call ends `cancelled` with `reason: 'skipped'`, and a withdrawn question carries `response: 'cancel'`.
- `bot-names.test.ts`: `of` finds the row of a session and answers `undefined` for another bot's session.
- `bot-wake.test.ts`: `began` holds a main turn that `posted` answers and `finished` ends. It does nothing while the wake waits on that back session. `stopped` cancels the back turn with a duration above zero.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- Waiting: task 01 and the by-hand items below were not run, because this build was told not to start or connect to a daemon. Each is for Softov on a test daemon with `XDG_CONFIG_HOME` in a scratch folder.
  - The session's `status` has no `InProgress` bit after an approval on the back session and the end of its turn.
  - A message sent on the main chat after that starts a turn on the back session, with no notice, and no "Steering" message stays behind.
  - An approval answered on the back session clears its copy in the main chat at once, in a live client.
  - A message typed on the back session opens a main turn that shows running, and the back session's `post_message` reply ends it.
  - In ahpw, a message to a bot gets a reply, and the subagent call opens the back session.

## Departures from the plan

- Task 03's `began` takes six parameters, not the four that its step 6 names. The two more are the main chat's session, which `stopped` matches on, and the back session's chat, which `working` shows. The wake cannot find them synchronously, and the plugin holds both when it calls. The bot's name is read from `started`, filled at load.
- `TurnHandle.begin` is required rather than optional, so the stub handles in `bot-post.test.ts` and `bot-context.test.ts`, which the task does not name, answer `undefined` from it.
- `bot-ask.test.ts`, which task 02 does not name, held a case asserting that a withdrawn question leaves its copy and says nothing. The new behaviour makes that assertion wrong, so the case now asserts the copy leaves and `chat/inputCompleted` says `cancel`.
- Tasks 02 and 03 are in one commit. Task 03 changed `packages/bot/src/chat.ts` before task 02 was committed. A commit by path cannot split the two tasks in one file.

## Left for later

- Task 01, the by-hand checks, and every by-hand item above: see [task-01-the-back-session-checks-pass.md](task-01-the-back-session-checks-pass.md).
