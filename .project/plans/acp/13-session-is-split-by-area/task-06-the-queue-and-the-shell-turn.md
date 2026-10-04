---
title: The queue and the shell turn are one file
status: todo
depends: [task-05-a-prompted-turn.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L1541-L1718](../../../../packages/agent-acp/src/session.ts#L1541-L1718) - `runCommand`, `begin`, `startNext`"
  - "[code://packages/agent-acp/src/session.ts#L1791-L1814](../../../../packages/agent-acp/src/session.ts#L1791-L1814) - the member `ran`"
  - "[code://packages/agent-acp/src/session.ts#L1840-L1879](../../../../packages/agent-acp/src/session.ts#L1840-L1879) - the members `queue`, `unqueue`, `reorder`"
---

## Objective

`session/queue.ts` exports `Queue` and `createQueue(ctx)`, which hold what runs next and the host's own `!command` turn, with the members `ran`, `queue`, `unqueue` and `reorder`, unchanged; `session.ts` is left composing the areas, under 1,000 lines.

## Files

- `CREATE: packages/agent-acp/src/session/queue.ts` - `runCommand`, `begin`, `startNext`, `ran`, `queue`, `unqueue`, `reorder` (about 260 lines).
- `UPDATE: packages/agent-acp/src/session.ts:1541-1718,1791-1814,1840-1879` - those removed; `Object.assign(ctx, createQueue(ctx))`; the member `begin` calls `ctx.begin`; the returned object names `ran`, `queue`, `unqueue` and `reorder` as `ctx.<name>` where they stand today; the temporary `startNext` wire from task 05 goes.
- `UPDATE: packages/agent-acp/src/session/context.ts` - `SessionContext` extends `Queue`, and the `startNext` it declared since task 05 moves onto `Queue`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation and the `ctx.` prefix; `callTimes` and `withCallTimes` go with `runCommand`.
2. The four members move as `const <name>: Session['<name>'] = ...` with their bodies unchanged.
3. `begin` calls `ctx.openTurn` and `ctx.run`; `runCommand`'s parameter `run` keeps its name.
4. Confirm `session.ts` holds only what the plan's *Proposed architecture* says stays.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-acp` passes; `agent-acp-turn.test.ts` covers `!command`; no test in the package queues, unqueues or reorders, so those members are guarded by the pure-move check alone.
- The pure-move check in [plan.md](plan.md) prints only imports, exports and wiring.
- `wc -l packages/agent-acp/src/session.ts packages/agent-acp/src/session/*.ts` recorded: `session.ts` under 1,000 and no file over 700.

## Resume

