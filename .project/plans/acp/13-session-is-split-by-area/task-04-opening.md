---
title: Spawning, signing in and opening are one file
status: todo
depends: [task-03-what-the-server-sends.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L90-L99](../../../../packages/agent-acp/src/session.ts#L90-L99) - `advertised`, read only by `open`"
  - "[code://packages/agent-acp/src/session.ts#L125-L204](../../../../packages/agent-acp/src/session.ts#L125-L204) - `HOST_TOOLS`, `serversFor`, `AUTH_REQUIRED`"
  - "[code://packages/agent-acp/src/session.ts#L237-L253](../../../../packages/agent-acp/src/session.ts#L237-L253) - `endpoint`, `asked`, `toolsServer`"
  - "[code://packages/agent-acp/src/session.ts#L307-L316](../../../../packages/agent-acp/src/session.ts#L307-L316) - `extras` and `signIns`, read and written only by this area"
  - "[code://packages/agent-acp/src/session.ts#L929-L1152](../../../../packages/agent-acp/src/session.ts#L929-L1152) - `placed`, `signIn`, `signInFailure`, `open`"
---

## Objective

`session/opening.ts` exports `Opening` and `createOpening(ctx)`, which hold the server spawned in its machine, the sign-in, and the one opening every caller shares, unchanged.

## Files

- `CREATE: packages/agent-acp/src/session/opening.ts` - `advertised`, `HOST_TOOLS`, `serversFor`, `AUTH_REQUIRED`, `endpoint`, `asked`, `toolsServer`, `extras`, `signIns`, `placed`, `signIn`, `signInFailure`, `open` (about 365 lines).
- `UPDATE: packages/agent-acp/src/session.ts:90-99,125-204,237-253,307-316,929-1152` - those removed; `Object.assign(ctx, createOpening(ctx))`; `run` calls `ctx.open` and `ctx.signInFailure`; the temporary `open` wire from task 02 goes.
- `UPDATE: packages/agent-acp/src/session/context.ts` - `SessionContext` extends `Opening`, and the `open` it declared since task 02 moves onto `Opening`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation and the `ctx.` prefix; the module-level constants stay module-level in the new file, and `endpoint`, `asked`, `extras` and `signIns` become `let`s inside `createOpening`.
2. Inside `open`, `opening`, `loading`, `live`, `closes`, `takes`, `acpSessionId`, `record` and `watchedTurn` are read and written as `ctx.<name>`, including in the `connection.ended` callback, and the handlers and `learnModes`, `learnOffers`, `learnModels` are `ctx.<name>`.
3. `RequestError`, `machineAsked`, `connectAcp` and `watchSession` go with their users.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-acp` passes; `agent-acp-signin.test.ts` and `agent-acp-failure.test.ts` cover sign-in and a dying server; no test in the package runs a session in a machine, so `placed` is guarded by the pure-move check alone.
- The pure-move check in [plan.md](plan.md) prints only imports, exports and wiring.
- `wc -l packages/agent-acp/src/session.ts` recorded.

## Resume

