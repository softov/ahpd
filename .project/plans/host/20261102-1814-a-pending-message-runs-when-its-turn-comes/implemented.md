---
title: A pending message runs when its turn comes - implemented
date: 2026-11-02
refs:
  - git://ca82b8af - the last change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
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

## Verified

- Each new or changed case fails on `89ebe4d5`'s sources and passes with the change, as each task's *Resume* names.
- The sdk, agent-pi, bot, agent-cofold and agent-acp test files touched pass, each timeout under load passing alone.
- The protocol's cases pass, 647 of 647.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Not built: in a chat whose backend keeps its queue after a stop, an idle steering message runs behind what waits there.
- ACP and cofold keep that queue, and `Session.queue` appends to it.
- VS Code's host runs such a message ahead of queued work ([queueDrainContribution.ts#L260-L262](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L260-L262)).
- Found beside Q4 and F3, not a label: Claude starts its next queued message once a stopped turn's result comes.
- Its site is [`code://packages/agent-claude/src/session/query.ts#L1150-L1159`](../../../../packages/agent-claude/src/session/query.ts#L1150-L1159).
- VS Code's host leaves queued messages queued after a cancel ([agentSideEffects.ts#L1950-L1954](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1950-L1954)).
