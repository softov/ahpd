---
title: Config, modes and models are one file
status: implemented
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

- Done: `session/config.ts` (398 lines) exports `Config` and `createConfig(ctx)`, holding `offers` and `listedModels` as the factory's own `let`s, `learnModes` through `chooseModel`, and the members `models` and `setConfig`. `session.ts` calls `Object.assign(ctx, createConfig(ctx))` and names `models: ctx.models` and `setConfig: ctx.setConfig` where the members stood. `receivedUpdate`, `open`, `run` and `sessionState` reach the moved functions as `ctx.<name>`.
- Gates: `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm exec vitest run packages/agent-acp/test` 146/146.
- `wc -l packages/agent-acp/src/session.ts` 1706 (was 2054); `session/config.ts` 398 (the plan's "about 390").
- Pure-move check: 31 lines, all wiring - task 01's 29 plus `models: () => {` and `setConfig: async (key, value): Promise<true | string> => {`, the two members that became `ctx.models` and `ctx.setConfig`.
- Departures:
  - The `ctx` literal is cast `as unknown as SessionContext`, not `as SessionContext`. The plain cast is checked before the areas are assigned and rejects a literal missing `Config`'s nine members and `open` (TS2352), which is every task from here on. The wiring is still `Object.assign(ctx, createConfig(ctx))`; only the cast widened, with a comment saying why.
  - `setConfig` is typed `NonNullable<Session['setConfig']>`, not `Session['setConfig']`. `setConfig` is optional on `Session`, so the indexed type carries `undefined` and every caller would have to guard it. `ran` is optional too, so task 06 needs the same. `models` is required on `Session` and matches the plan exactly.
- Missed on the first pass and caught by `agent-acp-catalog.test.ts` (8 failures): deleting `setConfig` from the returned object without putting `setConfig: ctx.setConfig` back. The member is back in its old place, after `answer`.
- `SessionContext` declares `open` as the temporary wire this task calls for; task 04 moves it onto `Opening`.
- Next: [task-03-what-the-server-sends.md](task-03-what-the-server-sends.md).

