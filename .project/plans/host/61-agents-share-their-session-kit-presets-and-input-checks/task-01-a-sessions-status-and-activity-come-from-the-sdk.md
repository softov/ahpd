---
title: A session's status and activity come from the sdk
status: done
depends: []
layer: "sdk, agent-acp, agent-claude, agent-cofold, agent-pi"
refs:
  - "[code://packages/sdk/src/catalog.ts#L18-L25](../../../../packages/sdk/src/catalog.ts#L18-L25) - `Status`"
  - "[code://packages/agent-acp/src/session.ts#L79](../../../../packages/agent-acp/src/session.ts#L79) - `let activity`, read at 169, 196 and 211"
  - "[code://packages/agent-acp/src/session.ts#L88-L106](../../../../packages/agent-acp/src/session.ts#L88-L106) - `doing` and `status`"
  - "[code://packages/agent-claude/src/session/parts.ts#L62-L68](../../../../packages/agent-claude/src/session/parts.ts#L62-L68) - `doing`"
  - "[code://packages/agent-claude/src/session/parts.ts#L192-L195](../../../../packages/agent-claude/src/session/parts.ts#L192-L195) - `status`"
  - "[code://packages/agent-claude/src/session.ts#L149](../../../../packages/agent-claude/src/session.ts#L149) - `ctx.activity` read, as at 167 and 214"
  - "[code://packages/agent-cofold/src/runs.ts#L53-L68](../../../../packages/agent-cofold/src/runs.ts#L53-L68) - `doing` and `status`"
  - "[code://packages/agent-cofold/src/session.ts#L238](../../../../packages/agent-cofold/src/session.ts#L238) - `ctx.activity` read, as at 253 and 273"
  - "[code://packages/agent-pi/src/session.ts#L113](../../../../packages/agent-pi/src/session.ts#L113) - `let activity`, read at 955"
  - "[code://packages/agent-pi/src/session.ts#L179-L184](../../../../packages/agent-pi/src/session.ts#L179-L184) - `doing`"
  - "[code://packages/agent-pi/src/session.ts#L370-L373](../../../../packages/agent-pi/src/session.ts#L370-L373) - `status`"
---

## Objective

`statusOf({ waiting, active, failed })` and `activityOf(emit)` are exported from `@ahpd/sdk`, and the four backends use them in place of their own `status` and `doing`.

## Files

- `UPDATE: packages/sdk/src/catalog.ts` - `statusOf` and `activityOf` after `Status`.
- `UPDATE: packages/sdk/src/index.ts:76` - added to the `catalog.js` export line.
- `CREATE: packages/sdk/test/session-kit.test.ts` - the helper's cases.
- `UPDATE: packages/agent-acp/src/session.ts:79,88-106,169,196,211` - `const activity = activityOf(emit)`; `doing` is `activity.say`; reads are `activity.current()`; `status` is `statusOf({ waiting: ctx.permissions.size > 0, active: ctx.active !== undefined, failed: ctx.failed !== undefined })`.
- `UPDATE: packages/agent-claude/src/session/parts.ts:62-68,192-195`, `session.ts:149,167,214` - the same over `ctx`; `ctx.activity` holds the `activityOf` handle; `status` passes truthiness as today.
- `UPDATE: packages/agent-cofold/src/runs.ts:53-68`, `session.ts:238,253,273` - the same, emitting through `start.emit`.
- `UPDATE: packages/agent-pi/src/session.ts:113,179-184,370-373,955` - the same.

## Steps

1. `statusOf`: `waiting ? Status.InputNeeded : active ? Status.InProgress : failed ? Status.Error : Status.Idle`.
2. `activityOf(emit)`: `{ say(said?: string): void; current(): string | undefined }`; `say` emits `chat/activityChanged` then `session/activityChanged`, with `activity` only when defined, and nothing when `said` equals the last.
3. Each backend keeps its own doc comment on what waiting means for it.

## Validation

- `session-kit.test.ts`, a new helper's cases: `statusOf` for each of the four outcomes and for waiting with active; `activityOf` emits two actions for a change, none for a repeat, and two with no `activity` for `undefined`.
- A pure refactor in the backends: every agent package's tests stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume

- **Implemented** 2026-10-10 on `build/agents/167a4a60`.
- `packages/sdk/src/catalog.ts` holds `statusOf`, `activityOf` and `titleFrom` beside `Status`.
- The `StatusBits` and `Activity` interfaces are beside them.
- `statusOf` reads waiting first, then active, then failed.
- That is the order the four backends already answered in: `InputNeeded`, `InProgress`, `Error`, `Idle`.
- `activityOf(emit)` holds the last thing said and answers `say` and `current`.
- `say` emits `chat/activityChanged` then `session/activityChanged`.
- It carries no `activity` key where it clears, and emits nothing where the value did not change.
- Each backend keeps one delegation and no local function, so the plan's `rg -n "const doing|const status = \(\)"` finds nothing.
- No backend repeats the three conditions. acp's are `ctx.doing` and `ctx.status`.
- claude's and cofold's are properties of the object their area returns.
- pi has no such object, so its ten call sites say `activity.say(...)`.
- One local `bits()` is what its three status reads share.
- Each backend's reading of its own three conditions is unchanged: acp waits on `ctx.permissions`, claude on `ctx.pending`.
- claude reads all three as truthiness, cofold waits on its `pending` map, and pi reads its own four.
- `packages/sdk/test/session-kit.test.ts` is 14 cases over the three helpers.
- Every agent package's tests are unchanged.
- Gates: `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` all pass.
- The full suite passes 4869 of 4870 tests over 272 files.
- The one failure is `changes-refresh.test.ts`, the load flake, which passes 29 of 29 alone.
