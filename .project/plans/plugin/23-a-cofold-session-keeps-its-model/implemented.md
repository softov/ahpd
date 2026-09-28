---
title: A cofold session reopens on the model its turns ran on - implemented
date: 2026-09-28
refs:
  - git://1d00d3f
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - `modelReferenceOf`, the reference a run resolves"
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts) - `openTurn` puts the model on the message and passes it to `run()`"
  - "[code://packages/agent-cofold/src/transcript.ts](../../../../packages/agent-cofold/src/transcript.ts) - `turnsOf` reads each run's model"
  - npm://@cofold/agents@^0.1.2 - `RunArgs.model` and `RunRecord.model`
---

A cofold session shows and runs on the model its turns ran on, live, after a reconnect and after the daemon restarts.

## What was built

- `@cofold/agents` 0.1.2, in the cofold repository: a run keeps the model reference it was told on its `RunRecord`.
- [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - `modelReferenceOf`: the turn's model over the session's, else `options.model`, else the harness file's.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - `openTurn` puts the reference on `message.model` with the client's `config`, and `startTurn` passes it to `run()`; the non-protocol `Turn.model` is gone.
- [`code://packages/agent-cofold/src/transcript.ts`](../../../../packages/agent-cofold/src/transcript.ts) - a rebuilt turn carries its run's model as `message.model.id` and `usage.model`.

## Verified

- `packages/agent-cofold/test/agent-cofold-turn.test.ts` covers the model on `chat/turnStarted`; `packages/agent-cofold/test/agent-cofold-store.test.ts` covers a restart on `open_router/x` and a run recorded without a model; each failed first.
- Task 04 read VS Code: a turn with no model reaches the person as `Error: (start_failed) <the sentence>` naming the configuration file, so nothing changed.
- cofold 71 files, 832 tests; ahpd `pnpm test` 104 files, 1439 tests, `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- none.

## Left for later

- none.
