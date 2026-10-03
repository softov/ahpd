---
title: A session forks where the server can
status: todo
depends: [task-01-a-resume-does-not-replay.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L20-L23](../../../../packages/agent-acp/src/session.ts#L20-L23) - the comment that lists a fork as unsupported"
  - "[code://packages/agent-acp/src/session.ts#L1006-L1147](../../../../packages/agent-acp/src/session.ts#L1006-L1147) - `open`, where `Start.forkAt` becomes a fork"
  - "[code://packages/sdk/src/types/agent.ts#L357](../../../../packages/sdk/src/types/agent.ts#L357) - `chats.fork`, a static field of the agent; `probe` spawns nothing"
  - "[code://packages/sdk/src/types/session.ts#L245-L260](../../../../packages/sdk/src/types/session.ts#L245-L260) - `forkPoint`, which offers the control per turn"
  - "[code://.project/plans/host/19-a-fork-copies-through-the-turn/task-01-the-contract-says-a-fork-copies-through-the-turn.md](../../host/19-a-fork-copies-through-the-turn/task-01-the-contract-says-a-fork-copies-through-the-turn.md) - the contract this task is written to; done first"
  - "[code://packages/agent-acp/test/agent-acp.test.ts](../../../../packages/agent-acp/test/agent-acp.test.ts) - the scripted server"
---

## Objective

A client is offered a fork of an ACP session's last turn when the server advertises `session.fork`, and taking it opens a new ACP session copied from the old one.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts` - `unstable_forkSession` on the connection.
- `UPDATE: packages/agent-acp/src/session.ts` - `forkPoint` for the last turn only, and the fork in `open` when `Start.forkAt` is set.
- `UPDATE: packages/agent-acp/src/session.ts:20-23` - the comment no longer lists a fork as unsupported.
- `UPDATE: packages/agent-acp/test/agent-acp.test.ts` - the cases below.

## Steps

1. How `chats.fork` is reported waits on the open question in the plan's Resume state; `chats.fork` is static (`agent.ts:357`) and the server's `session.fork` is known only once a session has spawned it.
2. `forkPoint(turnId)` answers the end of the chosen turn, its last entry, as host 19's contract says, and only for the last completed turn; every other turn answers `undefined`, because `session/fork` copies the whole session and cannot cut.
3. Wait for host 19 task 01, which rewrites the `forkPoint` contract this step follows.
4. In `open`, when `Start.resume` and `Start.forkAt` are set, call `unstable_forkSession` with the old session id and use the id it answers.
5. A `forkAt` that is not the end of the last turn is refused with a sentence, since the control was never offered for it.

## Validation

- `packages/agent-acp/test/agent-acp.test.ts`: with `session.fork`, the last turn's fork point is its last entry and an earlier turn has none; forking sends `session/fork` and the new session prompts under the new id; without it, no fork point at all.
- `pnpm test`, `pnpm typecheck` green.

## Resume

