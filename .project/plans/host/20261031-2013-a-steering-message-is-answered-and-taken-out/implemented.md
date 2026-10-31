---
title: A steering message is answered when it is taken, and taken out when the agent reads it - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - pi's `steer`, its `queue_update` case and its chat state"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts) - the bot's `steer`"
---

A steering message a client sends while a pi or a bot turn runs is said back inside the dispatch, so the client that sent it is answered with its own origin, and taken out of every client's state when the agent reads it.

## What was built

- pi: `steer` says the message as the chat's steering message and holds it as `steeringMessage` in the chat's state, as every client's reducer holds it. The ids handed to pi are kept in order, and pi's `queue_update`, said on every change of pi's steering queue, takes out the oldest ones pi no longer counts with `chat/pendingMessageRemoved`. `PiBackend.steer` answers with pi's disposition, and a message pi never queued, handled by an extension or failed, is taken out at once.
- The bot: `steer` says the message, then the turn that takes it in names it as its `queuedMessageId`, which takes it out of every client's state.
- [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md), the `Turns` section, [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), the `chat/pendingMessageSet` row, and pi's README.
- One case in `agent-pi.test.ts` and one in `bot-chat.test.ts`.

## Verified

- On `ab07054c` both cases fail for the reason they name: nothing is said for the message.
- After the change, `agent-pi`, `bot`, `automation-wake`, `host-input`, `session-events` and `host-local-turns` pass, 35 files and 519 cases.
- The round's full run at two workers: `test:unit` passes 7336 cases with one timeout (`plugin-i18n`, its check in a child), and `test:processes` 693 with two timeouts (`computer-libvirt`); the two files pass whole alone (32).
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- Task 03 is dropped. A session in a machine answers a steering message already: the proxy's `carry` takes `start.handed` inside the dispatch for every action it hands on, and a case with an inner backend that takes the message passed on `ab07054c`.

## Left for later

- none.
