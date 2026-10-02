---
title: A fork opens a branched session
status: done
depends: [task-01-a-turn-names-where-a-fork-cuts.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L65-L107](../../../../packages/agent-pi/src/backend.ts#L65-L107) - `BackendOptions`, `openPi`, `resumeOrCreate`"
  - "[code://packages/agent-pi/src/session.ts#L243-L248](../../../../packages/agent-pi/src/session.ts#L243-L248) - the options `opened` passes"
  - "[code://packages/agent-pi/src/agent.ts#L70-L85](../../../../packages/agent-pi/src/agent.ts#L70-L85) - the `Agent` literal, where `chats` is declared"
  - "[code://packages/agent-cofold/src/session.ts#L213-L220](../../../../packages/agent-cofold/src/session.ts#L213-L220) - the refusals to copy"
  - "[code://test/agent-cofold-fork.test.ts](../../../../test/agent-cofold-fork.test.ts) - the fork test shape, session-level and through the host"
---

## Objective

A pi session created with `resume` and `forkAt` continues a new pi session branched from the source through that entry, and the source is left as it was.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:65-107` - `BackendOptions.forkAt?: string`; `resumeOrCreate` opens the source and calls `createBranchedSession(forkAt)` before the `AgentSession` is built.
- `UPDATE: packages/agent-pi/src/session.ts:243-248` - pass `start.forkAt`.
- `UPDATE: packages/agent-pi/src/agent.ts` - `chats: { fork: true }`.
- `UPDATE: packages/agent-pi/src/session.ts:18-21` - the header says how a fork is made now.
- `UPDATE: packages/agent-pi/README.md:57` - fork moves from what does not map to what does.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. In `resumeOrCreate`, when `forkAt` is set: no `resume`, or a source `findById` cannot find, throws saying so; otherwise `SessionManager.open(found, sessionDir, cwd)` then `createBranchedSession(forkAt)`, and return that manager.
2. `forkAt` and `rewindAt` together is refused, as the sibling refuses it.
3. Declare `chats: { fork: true }` on the agent.
4. Correct the two comments and the README line, in each file's own style.

## Validation

- A test against a real `SessionManager` in a temporary `sessionDir`, no model: write a source session with two user and assistant pairs, branch at the first answer's entry, and check the new file holds only the first pair, the new id differs, and the source file is unchanged.
- A host-level case, shaped like `test/agent-cofold-fork.test.ts`: `createChat` with `source.kind: 'fork'` on a pi turn is accepted and the new session's backend is opened with that `forkAt`.
- Refusals: no `resume`, an unknown source, `forkAt` with `rewindAt`.
- `pnpm test`, `pnpm typecheck` green.
