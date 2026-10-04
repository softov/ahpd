---
title: Config, modes and models are one file
status: todo
depends: [task-01-the-shared-state-is-one-context.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L271-L287](../../../../packages/agent-acp/src/session.ts#L271-L287) - `offers` and `listedModels`, read and written only by this area"
  - "[code://packages/agent-acp/src/session.ts#L400-L510](../../../../packages/agent-acp/src/session.ts#L400-L510) - `learnModes` to `choicesOf`"
  - "[code://packages/agent-acp/src/session.ts#L530-L590](../../../../packages/agent-acp/src/session.ts#L530-L590) - `optionControl` and `schemaOf`"
  - "[code://packages/agent-acp/src/session.ts#L1273-L1311](../../../../packages/agent-acp/src/session.ts#L1273-L1311) - `chooseModel`"
  - "[code://packages/agent-acp/src/session.ts#L1724-L1737](../../../../packages/agent-acp/src/session.ts#L1724-L1737) - the member `models`"
  - "[code://packages/agent-acp/src/session.ts#L1936-L2052](../../../../packages/agent-acp/src/session.ts#L1936-L2052) - the member `setConfig`"
---

## Objective

`session/config.ts` exports `Config` and `createConfig(ctx)`, which hold the server's modes, config options and models, the schema drawn from them, and the members `models` and `setConfig`, unchanged.

## Files

- `CREATE: packages/agent-acp/src/session/config.ts` - `offers`, `listedModels`, `learnModes`, `modelOption`, `modeOption`, `keyOf`, `controlOptions`, `learnOffers`, `learnModels`, `configChanged`, `offersChanged`, `choicesOf`, `optionControl`, `schemaOf`, `chooseModel`, `models`, `setConfig` (about 390 lines).
- `UPDATE: packages/agent-acp/src/session.ts:271-287,400-510,530-590,1273-1311,1724-1737,1936-2052` - those removed; `Object.assign(ctx, createConfig(ctx))`; the returned object names `models: ctx.models` and `setConfig: ctx.setConfig` where they stand today; `receivedUpdate`, `open`, `run` and `sessionState` call the moved functions as `ctx.<name>`.
- `UPDATE: packages/agent-acp/src/session/context.ts` - `SessionContext` extends `Config`, and declares `open` until task 04 moves it.

## Steps

1. Move each declaration with its comment, unchanged but for indentation and the `ctx.` prefix; `offers` and `listedModels` become `let`s inside `createConfig`.
2. `models` and `setConfig` move as `const models: Session['models'] = ...` and `const setConfig: Session['setConfig'] = ...` with their bodies unchanged.
3. `setConfig` calls `ctx.open`, which is still in `session.ts`: assign it onto `ctx` there and declare it on `SessionContext`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-acp` passes; `agent-acp-catalog.test.ts` and `agent-acp.test.ts` cover the config options, modes and models.
- The pure-move check in [plan.md](plan.md) prints only imports, exports and wiring.
- `wc -l packages/agent-acp/src/session.ts` recorded.

## Resume

