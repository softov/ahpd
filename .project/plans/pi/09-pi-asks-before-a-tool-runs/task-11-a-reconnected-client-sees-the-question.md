---
title: A client that reconnects sees what pi is waiting on
status: implemented
depends: [task-01-a-call-can-wait-on-a-person.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L892](../../../../packages/agent-pi/src/session.ts#L892) - `sessionState`, which leaves `inputNeeded` out"
  - "[code://packages/agent-pi/src/session.ts#L212](../../../../packages/agent-pi/src/session.ts#L212) - `pending`, the questions this session is waiting on"
  - "[code://packages/agent-claude/src/session.ts#L2758](../../../../packages/agent-claude/src/session.ts#L2758) - claude's `sessionState` carries `inputNeeded`"
  - "[code://packages/agent-cofold/src/session.ts#L1220](../../../../packages/agent-cofold/src/session.ts#L1220) - cofold's does too"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `SessionState.inputNeeded`, in `dist/types/channels-session/state.d.ts`
---

## Objective

A session waiting on a person answers `inputNeeded` in its snapshot, so a client that reloads or connects late shows the question and can answer it.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:892` - `sessionState` carries `inputNeeded` from `pending`, as the siblings do.
- `UPDATE: packages/agent-pi/test/` - the case below.

## Steps

1. Add `inputNeeded: [...pending.values()].map(entry)` to `sessionState` when anything is pending, in the shape `session/inputNeededSet` sends.

## Validation

- Reproduced on 2026-09-28 with a scratch daemon and three reads outside the workspace: the live client got three `session/inputNeededSet`, and a second client that subscribed while the third waited got status 24 and a `pending-confirmation` call but no `inputNeeded` in the session state.
- A case: a call waiting on a person, then `sessionState()` has one `inputNeeded` entry equal to the one `session/inputNeededSet` sent; after `confirm`, none. Today it has none, so it fails first.
- By hand, for Softov: leave a permission unanswered, reload VS Code, and the prompt is there.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-28.
`sessionState` in `packages/agent-pi/src/session.ts` carries `inputNeeded`, each pending entry as `session/inputNeededSet` sent it, only while something is pending, as claude and cofold do.
`packages/agent-pi/test/agent-pi.test.ts` adds `answers what it is waiting on in its state, so a client that connects late sees the question`, which failed first with no `inputNeeded`.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1492 tests passed.
