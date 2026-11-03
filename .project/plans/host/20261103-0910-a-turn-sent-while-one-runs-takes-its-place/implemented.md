---
title: A turn sent while one runs takes its place - implemented
date: 2026-11-03
refs:
  - git://0fc56e27 - the change
  - git://0fc35a29 - task 02's change
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts)"
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts)"
---

A `chat/turnStarted` a client sends while a turn runs is handed to the backend, with no refusal.
The backend says its start at once, so it takes the running turn's place in every client's state.
The backend runs it once the work in front of it ends.
The replaced turn runs on, its actions name it, and it is in no history.
A stop of the turn that took its place stops the work in flight and drops the turns waiting.
The host applies a chat's action sent after a stop at once.

## What was built

- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `run` hands every start to its backend.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - no wait for a stopped turn's end, and steering only into a turn the chat holds as running.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a backend's end of a turn the chat does not hold is not said, and `letGo` is gone.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - `handed`, said at once and sent once the CLI owes nothing in front of it.
  A `!` command sent as a turn runs at once, and a steer a client takes back is withdrawn.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts), [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts), [`code://packages/agent-acp/src/session/queue.ts`](../../../../packages/agent-acp/src/session/queue.ts), [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - the turns said while another ran, each run once the run in front of it ends.
- [`code://examples/echo/agent.ts`](../../../../examples/echo/agent.ts), [`code://examples/notes/agent.ts`](../../../../examples/notes/agent.ts) - the same, and a run that ends only its own turn.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), [`code://docs/sdk/TERMINALS.md`](../../../../docs/sdk/TERMINALS.md) - the `chat/turnStarted` and `chat/turnCancelled` rows, and a command sent as a turn.

## Verified

- On `feb72387`'s sources the new and changed cases fail: seventeen of them, in nine test files.
- They are three in host-turn, one in host-terminals, three in agent-pi, and four in the two cofold files.
- The rest are one in the ACP turn file, one in Claude's turn-recorded file, and two in the bot chat file.
- With the change every test file of agent-cofold, agent-acp, the bot and agent-pi passes, one file at a time.
- So does every test file of agent-claude.
- So does every sdk test file that names a turn start, a stop or a pending message, the nested-process and wire files aside.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Task 02

A stop takes the chat's steering message with it.
Once the backend has had the stop, it is asked to let go of the steering message.
The host takes out one the backend says nothing of.
pi empties its own steering queue at a stop, so a steer it was handed reaches no later run.
A pi resume whose continue threw before pi wrote anything continues again from the same failed reply, with no second context edit.

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the steering message taken out at a stop.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts), [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `clearSteering` at a stop, and `failedReply`, which `resume` reads.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `chat/turnCancelled` row.
- The two problems the task closes are deleted: a-backend-keeps-a-steer-the-client-took-back and a-pi-resume-after-a-failed-continue-is-refused.

Verified:

- On `feb72387`'s sources the four new and changed cases fail, one each in the host steering, pi steering, pi disk and cofold turn files.
- With the change every test file a stop or a steer reaches passes, one file at a time: seventy-two of them.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- The cofold case that took back a steering message a stopped run handed back now reads it taken out with the stop.
- A cofold plugin case that woke a sleeping session with a turn wakes it with a queued message.
  A turn sent there takes the place of the run the resume reopens, so that run's approval is in no client's state.
- Claude takes up a message queued after a stop when its CLI has answered the stopped prompt, as the plan's *Risks and tradeoffs* says.
