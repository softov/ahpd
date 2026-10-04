---
title: Spawning, signing in and opening are one file
status: implemented
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

- Done: `session/opening.ts` (372 lines) exports `Opening` and `createOpening(ctx)`. `advertised`, `HOST_TOOLS`, `serversFor` and `AUTH_REQUIRED` are module-level in the new file; `endpoint`, `asked`, `toolsServer`, `extras` and `signIns` are the factory's own, and `placed`, `signIn`, `signInFailure` and `open` sit after them. `session.ts` calls `Object.assign(ctx, createOpening(ctx))`, and `run` reaches `ctx.open` and `ctx.signInFailure`. `SessionContext extends Config, Handlers, Opening`, and the `open` it declared as a temporary wire since task 02 is gone - `open` is now declared on `Opening`.
- Gates: `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm exec vitest run packages/agent-acp/test` 146/146, `agent-acp-signin.test.ts` 5/5 and `agent-acp-failure.test.ts` among them. No test runs a session in a machine, so `placed` is covered by the pure-move check alone, as the task allows.
- `wc -l packages/agent-acp/src/session.ts` 944 (was 1301); `session/opening.ts` 372 (the plan's "about 365").
- Pure-move check: 43 lines, all wiring - task 03's 38 plus five import lines that moved whole: `RequestError` (`import { RequestError } ...`), `machineAsked` on the `@ahpd/sdk` value import, `watchSession`, `connectAcp`, and the `AgentCapabilities` and `McpServer as AcpMcpServer` entries of the SDK type import. `RequestError` moved to a named import of its own in `session/opening.ts` because there it is the only value that file needs from the SDK.
- `Opening` carries two members rather than the twelve declarations the file holds: only `open` and `signInFailure` are read outside the area, so `placed`, `signIn`, `endpoint`, `asked`, `toolsServer`, `extras` and `signIns` stay factory-local.
- The plan's `session.ts:90-99,125-204` range is one block that also holds `inline`, `referencing` and `CLOSE_GRACE_MS` between `advertised` and `HOST_TOOLS`. Those three are named by task 05 or stay in `session.ts`, so they were restored to `session.ts` immediately after `NOT_AN_ANSWER` - their order relative to the constants they sat between is unchanged.
- Next: [task-05-a-prompted-turn.md](task-05-a-prompted-turn.md).

