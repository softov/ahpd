---
title: What the server sends the session is one file
status: implemented
depends: [task-02-config-and-models.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L512-L528](../../../../packages/agent-acp/src/session.ts#L512-L528) - `commandLeaf`, read only by `receivedUpdate`"
  - "[code://packages/agent-acp/src/session.ts#L592-L685](../../../../packages/agent-acp/src/session.ts#L592-L685) - `receivedUpdate`"
  - "[code://packages/agent-acp/src/session.ts#L687-L799](../../../../packages/agent-acp/src/session.ts#L687-L799) - `fs/*` and `terminal/*`: `uriOf` to `releaseTerminal`"
  - "[code://packages/agent-acp/src/session.ts#L801-L927](../../../../packages/agent-acp/src/session.ts#L801-L927) - `askPermission` and `settlePermissions`"
  - "[code://packages/agent-acp/src/session.ts#L1888-L1925](../../../../packages/agent-acp/src/session.ts#L1888-L1925) - the member `confirm`, which answers `askPermission`"
---

## Objective

`session/handlers.ts` exports `Handlers` and `createHandlers(ctx)`, which hold every notification and request the server sends this session and the member `confirm` that answers a permission, unchanged.

## Files

- `CREATE: packages/agent-acp/src/session/handlers.ts` - `commandLeaf`, `receivedUpdate`, `uriOf`, `readTextFile`, `writeTextFile`, `environmentOf`, `openTerminal`, `terminalOf`, `terminalOutput`, `waitForTerminalExit`, `killTerminal`, `releaseTerminal`, `askPermission`, `settlePermissions`, `confirm` (about 425 lines).
- `UPDATE: packages/agent-acp/src/session.ts:512-528,592-927,1888-1925` - those removed; `Object.assign(ctx, createHandlers(ctx))`; `open` hands `connectAcp` the handlers as `ctx.<name>`; `cancel` calls `ctx.settlePermissions`; the returned object names `confirm: ctx.confirm` where it stands today.
- `UPDATE: packages/agent-acp/src/session/context.ts` - `SessionContext` extends `Handlers`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation and the `ctx.` prefix; `pathToFileURL` and the ACP request and response types go with them.
2. `confirm` moves as `const confirm: Session['confirm'] = ...` with its body unchanged.
3. `receivedUpdate` calls `ctx.configChanged`, `ctx.offersChanged` and `ctx.learnOffers`; `modes`, `commands`, `title`, `record` and `mapping` are read and written as `ctx.<name>`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-acp` passes; `agent-acp-ports.test.ts` covers files, terminals and permissions, and `agent-acp-turn.test.ts` the updates.
- The pure-move check in [plan.md](plan.md) prints only imports, exports and wiring.
- `wc -l packages/agent-acp/src/session.ts` recorded.

## Resume

- Done: `session/handlers.ts` (452 lines) exports `Handlers` and `createHandlers(ctx)`, holding `commandLeaf`, `receivedUpdate`, `uriOf`, `readTextFile`, `writeTextFile`, `environmentOf`, `openTerminal`, `terminalOf`, `terminalOutput`, `waitForTerminalExit`, `killTerminal`, `releaseTerminal`, `askPermission`, `settlePermissions` and the member `confirm`. `session.ts` calls `Object.assign(ctx, createHandlers(ctx))`, hands `connectAcp` the handlers as `ctx.<name>`, calls `ctx.settlePermissions` from `cancel`, and names `confirm: ctx.confirm` where the member stood. `SessionContext extends Config, Handlers`.
- Gates: `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm exec vitest run packages/agent-acp/test` 146/146, `agent-acp-ports.test.ts` 10/10 and `agent-acp-turn.test.ts` 22/22 among them.
- `wc -l packages/agent-acp/src/session.ts` 1301 (was 1706); `session/handlers.ts` 452 (the plan's "about 425").
- Pure-move check: 38 lines, all wiring - task 02's 31 plus the seven this task adds: the `writeTextFile` spread and the `terminal/*` line of the `connectAcp` handlers, `confirm: (toolCallId, approved, optionId) => {`, and four import lines that are now type-only or gone (`closePlan, confirmationOptions, mapUpdate` reduced to `closePlan`, the `@ahpd/sdk` type line without `OpenedTerminal`, and `SessionConfigOption` and `SessionModeState` off the SDK import, which `session/config.ts` and `session/handlers.ts` now name themselves).
- No departure from the plan's tables. Two notes, neither a fork:
  - `Handlers` carries eleven members rather than fifteen declarations: `commandLeaf`, `uriOf`, `environmentOf` and `terminalOf` are read only inside the area, so they stay factory-local and the interface names the eleven other files reach for.
  - `confirm: ctx.confirm` keeps the member in today's place, which is what leaves the comment above `answer` ("which is the confirmation above") pointing at it.

