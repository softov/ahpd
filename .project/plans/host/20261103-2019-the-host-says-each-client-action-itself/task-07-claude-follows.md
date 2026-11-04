---
title: Claude follows the contract
status: done
depends: [task-04-the-session-contract-follows-iagent.md, task-05-the-host-owns-the-queue.md]
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts) - `beginTurn`, `steer`, `cancel`, `handOver`, `startNext`"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts) - the query, `consume`, the interrupt, the stream's end"
---

## Objective

Claude sends each prompt it is handed in order, and says no client's start.
It aborts its query at a stop, and resumes the conversation on the next send.
It declines steering until its prompt is out, and a stream that ends without a result fails its turn.

## Files

- `UPDATE: packages/agent-claude/src/session/turns.ts` - no start said; handed sends in order; `refuseTurn` ends a send that failed; `handOver`, `present`, `stopping`, `deferred` and the queue go.
- `UPDATE: packages/agent-claude/src/session/query.ts` - the abort closes the query and the next send starts one that resumes; a stream's end fails its sends.

## Steps

1. Drop the start Claude says for a client's turn (row 2, E-0001).
2. Send each handed prompt after the one before it (row 26, item 2).
3. End only a failed send's turn with chat/error (row 26, item 2).
4. Abort the query in `abort`, dropping every prompt and steer not read (row 23, item 3a).
5. Start a query that resumes the conversation at the next send (row 23).
6. Decline steering until the turn's prompt is out (row 24, item 3b).
7. Fail the pending sends of a stream that ends without a result (row 25, E-0011).
8. Log a refused model or agent and send on the current one (row 9, E-0012, H1-0016).

## Validation

- Add to `packages/agent-claude/test/agent-claude-failed-turn.test.ts`: Claude sends a turn handed behind a refused one.
- Add to `packages/agent-claude/test/agent-claude-late-steer.test.ts`: after a stop, no turn opens for steering.
- Add a case for a stream that ends without a result: the turn ends in chat/error, the next runs.

## Resume

- **From 05:** Claude's queue is fed by nothing and goes here with the drain behind it; its steering withdrawal is `withdrawSteeringMessage`.
- **From 05:** the `host-input` case on a steering message consumed as it arrives fails since 04.
- **Its cause:** Claude's own `chat/pendingMessageSet` of a steering message the host said.
- **Done:** steps 1 to 8, at the commit that closes this task, with a case for each validation item.
- **Booking:** with no backend start, the host says a turn's start on the chat's road as it hands the turn over.
- **Booked once:** the road drops a backend's start of a turn the chat holds, so 08's backends are not booked twice.
- **Ends:** a backend still reports a turn's end, a stop's included, and the road books it from that report.
- **Stop:** `abort` closes the CLI with its workers and tasks, and the next send starts one that resumes.
- **Stream end:** a stream with no result fails its turn in VS Code's words, and the next send resumes.
- **A thrown error:** still ends the session; VS Code's catch at L710-L718 rebinds it as well.
- **Item 2's case:** in `agent-claude-model-refusal`, whose fake refuses a model; a refused model is logged now.

