---
title: The queue and the shell turn are one file
status: done
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

- Done: `session/queue.ts` (264 lines) exports `Queue` and `createQueue(ctx)`, holding `runCommand`, `begin`, `startNext`, and the members `ran`, `queue`, `unqueue` and `reorder`. `session.ts` calls `Object.assign(ctx, createQueue(ctx))` and names `begin: ctx.begin`, `ran: ctx.ran`, `queue: ctx.queue`, `unqueue: ctx.unqueue` and `reorder: ctx.reorder` in today's places, so the returned object's member order is unchanged. `SessionContext extends Config, Handlers, Opening, Queue, Turn`, and the `startNext` wire this task called for is gone - `startNext` is declared on `Queue`. `callTimes` and `withCallTimes` moved whole with `runCommand`, which is their only user.
- Gates: `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm exec vitest run packages/agent-acp/test` 146/146, `agent-acp-turn.test.ts` 22/22 covering `!command`. No test queues, unqueues or reorders, so those three are guarded by the type check and the pure-move check alone, as the task allows.
- Final counts, against the plan's checklist of `session.ts` under 1,000 and no file over 700:

  | File | Lines | Plan |
  | --- | --- | --- |
  | `src/session.ts` | 321 | about 320 |
  | `src/session/common.ts` | 9 | 10 |
  | `src/session/config.ts` | 398 | 390 |
  | `src/session/context.ts` | 123 | 130 |
  | `src/session/handlers.ts` | 452 | 425 |
  | `src/session/opening.ts` | 372 | 365 |
  | `src/session/turn.ts` | 408 | 405 |
  | `src/session/queue.ts` | 264 | 260 |

  `session.ts` went 2,105 -> 321.
- Pure-move check over the whole plan: 55 removed lines with no counterpart, every one an import, a field that became a `SessionContext` field, or a member that became `ctx.<name>` (29 from task 01, then `models: () => {`, `setConfig: async (key, value) => {`, `confirm: (toolCallId, approved, optionId) => {`, the `writeTextFile` spread and the `terminal/*` line of `connectAcp`'s handlers, `begin:`, `ran:`, `queue:`, `unqueue:`, `reorder:`, and 12 import lines whose names moved to the area files).
- Step 4 confirmed: `session.ts` holds the header comment, the imports, `CLOSE_GRACE_MS`, `acpSession`'s head (`provider`, `emit`, `where`, `directories`, `inside`), `activity`, `modified`, `draft`, the funnel (`touch`, `doing`, `status`), the `ctx` literal, the five `Object.assign` calls, and the returned `Session` - with the area's members named as `ctx.<name>` in the places the plan's table and decisions give them, which is the one exception to "only what stays" the plan itself decides.
- No departure from the plan's tables. `ran` is typed `NonNullable<Session['ran']>` for the reason task 02 recorded: `ran` is optional on `Session`, so the indexed type carries `undefined`. `queue`, `unqueue`, `reorder` and `begin` are required and match the table exactly.
- `begin` keeps its own six-parameter signature rather than `Session['begin']`, because `startNext` calls it with the sixth argument `queuedMessageId` and `Session['begin']` takes five. A function whose sixth parameter is optional is still assignable to `Session['begin']`, so `begin: ctx.begin` type-checks in the returned object.

