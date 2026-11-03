---
title: cofold, pi, ACP and the bot follow the contract
status: todo
depends: [task-04-the-session-contract-follows-iagent.md, task-05-the-host-owns-the-queue.md]
layer: agents
refs:
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts) - steer, cancel, `untaken`, the queue"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - begin's preparation, steer, cancel, the queue"
  - "[code://packages/agent-acp/src/session/queue.ts](../../../../packages/agent-acp/src/session/queue.ts) - the queue and the wind-down hand"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts) - the bot's begin, steer and queue"
---

## Objective

Each of these backends sends the prompts it is handed, says no client's action, keeps no queue, and aborts at a stop.
cofold and pi answer a steer their run settled before reading with a promise of false.
Each answers false to a steer while its turn prepares, and puts the turn's instructions in its prompt.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts`, `packages/agent-cofold/src/turns.ts` - no start said; `sendSteeringMessage` hands back; `untaken` and the queue go.
- `UPDATE: packages/agent-pi/src/session.ts` - no start said; a stop checked after each step of preparation; the queue goes.
- `UPDATE: packages/agent-acp/src/session/turn.ts`, `packages/agent-acp/src/session/queue.ts` - no start said; a stop checked before the prompt; the queue goes.
- `UPDATE: packages/bot/src/chat.ts` - no start said; the queue goes.
- `UPDATE: packages/agent-cofold/src/turnagent.ts`, `packages/agent-acp/src/session.ts` - the turn's instructions in its prompt.

## Steps

1. Drop each backend's own start of a client's turn (row 2).
2. Remove each backend's queue and drain (rows 15, 16; H1-0026 to H1-0028; F-0004, F-0083, F-0136).
3. Answer a steer cofold's or pi's run settled before reading with false (row 18; item 3d; F-0095, F-0153).
4. Answer false to a steer while the turn prepares (rows 13, 17; F-0153, F-0155).
5. Check for a stop before pi and ACP send a prompt (row 10, H1-0045).
6. Drop everything held of the turn in `abort` (rows 11, 33).
7. Put the send's instructions in that turn's prompt (row 35; F-0019, F-0116, F-0135).

## Validation

- `packages/agent-cofold/test/agent-cofold-turn.test.ts`: a handed-back steer steers the active turn.
- `packages/agent-pi/test/agent-pi-steering.test.ts`: a stop during preparation sends no prompt.
- `packages/agent-pi/test/agent-pi-steering.test.ts`: a steer during pi's start steers that turn.
- `packages/bot/test/bot-chat.test.ts`: a stop takes the bot's pending steering out and starts nothing.
- One case each for ACP, cofold and pi: the send's instructions reach the prompt.

## Resume

