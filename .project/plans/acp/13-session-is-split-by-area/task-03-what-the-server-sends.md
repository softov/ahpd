---
title: What the server sends the session is one file
status: todo
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

