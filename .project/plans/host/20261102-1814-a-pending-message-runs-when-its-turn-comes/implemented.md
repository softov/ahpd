---
title: A pending message runs when its turn comes - implemented
date: 2026-11-02
refs:
  - git://46251ea3 - the last change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts)"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
---

A message that waits runs when its turn comes, as VS Code's host runs it.
A steering message sent with no turn running runs as a turn of its own, named by its id.
The steering message a running turn holds, sent again, reaches the backend once, and an edit of it is refused.
pi starts a message queued with nothing running at once, and names every queued message on its turn.
A bot's steer goes into the open turn, which goes on.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the idle steering message on the queued path, and the held one sent again.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `queue` and `ran` start the queue, and `startNext` names the message on its turn alone.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `steer` hands the message into the open turn and keeps its log line.
- [`code://packages/sdk/test/host-steering.test.ts`](../../../../packages/sdk/test/host-steering.test.ts) - a held steering message sent again.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) and [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md) - the `chat/pendingMessageSet` row and *Turns*.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - a stopped turn's result starts only what a message queued since asked for.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `queue` takes the pending message's `kind`.
- Claude, pi, ACP, cofold, the bot, the nested proxy and both examples put an idle steering message at the head of their queue.

## Verified

- Each new or changed case fails on `89ebe4d5`'s sources and passes with the change, as each task's *Resume* names.
- Task 04's three cases fail on `0229216e`'s sources, the queued message started at the stop, and pass with the change.
- Task 05's three cases fail on `ff7f255e`'s sources and pass with the change.
- The sdk, agent-pi, bot, agent-cofold and agent-acp test files touched pass, each timeout under load passing alone.
- The protocol's cases pass, 647 of 647.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 05: the host refused an idle steering message for a backend with no `steer`, ACP and the examples among them.
- It now refuses steering there only while a turn runs, so the message reaches the queue as the next turn.

## Left for later

- Found, not built: Claude, pi, ACP and cofold start the queue after a failed turn.
- VS Code's host starts it only after a turn that succeeded or ran a local command ([queueDrainContribution.ts#L66-L68](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L66-L68)).
- It holds even a newly queued message behind a failure a client may resume ([queueDrainContribution.ts#L256-L259](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L256-L259)).
