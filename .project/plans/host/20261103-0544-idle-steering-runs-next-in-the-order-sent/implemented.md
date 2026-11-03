---
title: Idle steering runs next in the order sent - implemented
date: 2026-11-03
refs:
  - git://54aad468 - task 01
  - git://6df67a4a - task 02
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

A steering message sent while no turn runs is the next turn, ahead of every queued message and behind the steering already waiting.
That holds in Claude, pi, cofold, the bot and the nested proxy, each of which takes steering.
A backend that takes no steering refuses it, a turn running or not.
A steering `!command` waits the same way and runs as a command, and a queued message under the held steering message's id is refused.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the refusal, idle or not, and the held steering check by id whatever the kind.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `Session.ran` takes the pending message's kind, as `queue` does.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `beginOrRun` hands the kind to both.
- The queues of Claude, pi, cofold and the bot - in the order things came, steering first, and the latest steering message shown.
- [`code://packages/agent-acp/src/session/queue.ts`](../../../../packages/agent-acp/src/session/queue.ts) and both examples - one kind again.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) and [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md) - where an idle steering message waits, and what is refused.

## Verified

- On `cde4dd6c`'s sources the refusal cases, two steering messages in order, the steering command and the queued set under a held id all fail.
- They pass with `54aad468` and `6df67a4a`.
- Each touched test file passes alone at one worker, as do the protocol's cases.
- `pnpm run typecheck` reports no errors.

## Departures from the plan

- Task 01 became the refusal and the queues it reaches, because upstream merged round 2's union as `#195` while this was built.
- Task 02 - the order is taken where a turn starts: the first steering entry, and then the head.
- Task 02 - the bot's order has no case, since no client path holds two idle steering messages in a bot's chat.

## Left for later

- None.
