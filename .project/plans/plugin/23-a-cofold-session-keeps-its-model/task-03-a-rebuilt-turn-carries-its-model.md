---
title: A rebuilt cofold turn carries the model it ran on
status: implemented
depends: [task-01-cofold-records-the-model-a-run-used.md, task-02-a-live-turn-carries-its-model.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/transcript.ts#L236-L244](../../../../packages/agent-cofold/src/transcript.ts#L236-L244) - `begin`, which builds a rebuilt turn's `message`"
  - "[code://packages/agent-cofold/src/transcript.ts#L180-L186](../../../../packages/agent-cofold/src/transcript.ts#L180-L186) - each run's `usage`, keyed by its `inputMessageId`"
  - "[code://packages/agent-claude/src/transcript.ts#L250-L256](../../../../packages/agent-claude/src/transcript.ts#L250-L256) - the sibling: a rebuilt turn's `usage.model`, read from claude's own session file"
  - file:///github/externals/vscode - `stateToProgressAdapter.ts` `turnsToHistory`: a request's model is `turn.message.model?.id ?? turn.usage?.model`
  - "[code://packages/agent-cofold/src/agent.ts#L611-L615](../../../../packages/agent-cofold/src/agent.ts#L611-L615) - `transcript()`"
---

## Objective

After the daemon restarts, a cofold session's rebuilt turns carry `message.model` and `usage.model`, so VS Code reopens it on the model its last turn ran on and its next turn runs there.

## Files

- `UPDATE: packages/agent-cofold/package.json` and the lockfile - the `@cofold/agents` release from task 01.
- `UPDATE: packages/agent-cofold/src/session.ts` - each run is started with the reference the turn runs on, as task 02 resolves it, as the run's `model` option.
- `UPDATE: packages/agent-cofold/src/transcript.ts` - each turn's `message.model` and `usage.model` from the run whose input message opened it.
- `UPDATE: packages/agent-cofold/test/` - the case below.

## Steps

1. Take the `@cofold/agents` release from task 01.
2. Start each run with `model` set to the reference task 02 puts on the turn's `message.model`, per decision [a-cofold-run-is-told-the-model-reference-it-runs-on](../../../decisions/a-cofold-run-is-told-the-model-reference-it-runs-on.md).
3. In `turnsOf`, give each turn opened by a run's `inputMessageId` that run's model, as the reference the backend offers, on `message.model` and on `usage.model`, as claude's rebuilt turns carry `usage.model`.
4. A run with no model leaves its turn without one.

## Validation

- An agent-cofold case: a session run on `open_router/x`, then a fresh backend over the same store (the restart), answers `transcript()` whose last turn has `message.model.id` and `usage.model` `open_router/x`.
  Today it has neither.
- A turn from a run recorded without a model has no `message.model` and no `usage.model`.
- `pnpm typecheck` and `pnpm test` green.
- By hand, for Softov: restart the daemon, reopen a cofold session in VS Code, and the picker shows its model.

## Resume

Implemented 2026-09-27.
`packages/agent-cofold` depends on `@cofold/agents` `^0.1.2`, and the lockfile resolves it.
The root `package.json` is raised to `^0.1.2` too and `minimumReleaseAgeExclude` names only `@cofold/agents@0.1.2`, so the lockfile holds no `@cofold/agents@0.1.1`.
`openTurn` answers the reference it put on `message.model`, and `startTurn` passes it to `run()` as the `model` option, which cofold keeps on the `RunRecord`.
`turnsOf` reads each run's `model` by its `inputMessageId` and puts it on the turn it opened, as `message.model.id` and as `usage.model`.
A run with no `model` leaves its turn with neither.
Two cases in `packages/agent-cofold/test/agent-cofold-store.test.ts` cover the restart on `open_router/x` and the run recorded without a model.
The restart case was written first and failed on the rebuilt turn's `message.model.id`: `AssertionError: expected undefined to be 'open_router/x' // Object.is equality`.
`node_modules/.bin/vitest run packages/agent-cofold`: 11 files, 112 tests passed.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 104 files, 1439 tests passed.
