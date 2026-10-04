---
title: The grant tables are their own file
status: todo
depends: [task-01-uri-names-helpers-and-state.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L156-L397](../../../../packages/sdk/src/host.ts#L156-L397) - `GREETINGS`, `NEEDS`, `UNGATED`, `dispatchNeeds`, `computerNeeds`, `PER_CONNECTION`, `seesConfig`, `Home`, `ACTION_HOMES`, `HOME_WORDS`"
  - "[code://packages/sdk/src/host.ts#L520-L538](../../../../packages/sdk/src/host.ts#L520-L538) - `GATE` and `refusalReason`"
  - "[code://packages/sdk/src/host.ts#L703-L726](../../../../packages/sdk/src/host.ts#L703-L726) - `DECLARED` and `REVERSE`, method tables inside the closure that read only `ROOT` and `AUTOMATIONS`"
  - "[code://packages/sdk/src/index.ts#L25](../../../../packages/sdk/src/index.ts#L25) - re-exports `refusalReason` from `./host.js`"
  - "[code://packages/sdk/test/users-gate.test.ts#L5](../../../../packages/sdk/test/users-gate.test.ts#L5) - imports `GATE` from `../src/host.js`"
---

## Objective

`host/gate.ts` holds what each method and each action needs and which channel a method is declared on, and `host.ts` still exports `GATE` and `refusalReason`.

## Files

- `CREATE: packages/sdk/src/host/gate.ts` - `GREETINGS`, `NEEDS`, `UNGATED`, `dispatchNeeds`, `computerNeeds`, `PER_CONNECTION`, `seesConfig`, `Home`, `ACTION_HOMES`, `HOME_WORDS`, `GATE`, `refusalReason`, `DECLARED`, `REVERSE`.
- `UPDATE: packages/sdk/src/host.ts:156-538` and `:703-726` - those declarations removed; `export { GATE, refusalReason } from './host/gate.js'`, and imports for the rest.

## Steps

1. Move each declaration with its comment, unchanged; `DECLARED` and `REVERSE` lose two spaces of indentation and gain `export`; `NEEDS`, `UNGATED`, `PER_CONNECTION` and `ACTION_HOMES` keep their order and grouping.
2. `gate.ts` imports `isRootChannel` and `ChannelKind` from `./channels.js`, `computerSource` from `../computers.js`, and the `Grant` and `Connection` types.
3. `host.ts` re-exports `GATE` and `refusalReason`, so `index.ts` and `users-gate.test.ts` are unchanged.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `users-gate.test.ts` passes unchanged, which shows `GATE` is the same object.
- `git diff -M --color-moved=zebra` shows every removed line as moved.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
