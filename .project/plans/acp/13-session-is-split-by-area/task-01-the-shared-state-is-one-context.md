---
title: The session's shared state is one context
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L255-L372](../../../../packages/agent-acp/src/session.ts#L255-L372) - the state declarations and their comments"
  - "[code://packages/agent-acp/src/session.ts#L66-L69](../../../../packages/agent-acp/src/session.ts#L66-L69) - `bag` and `UNTITLED`"
  - "[code://packages/agent-acp/src/session.ts#L374-L398](../../../../packages/agent-acp/src/session.ts#L374-L398) - `messageOf`, and the funnel `touch`, `doing`, `status`"
  - "[code://packages/agent-acp/src/session.ts#L213-L235](../../../../packages/agent-acp/src/session.ts#L213-L235) - `provider`, `emit`, `where`, `directories`, `inside`"
  - "[code://packages/sdk/src/host/context.ts](../../../../packages/sdk/src/host/context.ts) - the shape `SessionContext` copies"
---

## Objective

`session/context.ts` holds `SessionContext`, `session/common.ts` holds `bag`, `UNTITLED` and `messageOf`, and `acpSession` builds one `ctx` that every shared field lives on, with no code yet in another area file.

## Files

- `CREATE: packages/agent-acp/src/session/context.ts` - `SessionContext`: `options`, `start`, `provider`, `emit`, `where`, `inside`, `touch`, `doing`, `status`, and the 25 shared fields (`settings`, `turns`, `seeds`, `commands`, `modes`, `active`, `mapping`, `cumulative`, `live`, `acpSessionId`, `closes`, `takes`, `replay`, `loading`, `opening`, `cancelRequested`, `closed`, `failed`, `title`, `renamed`, `record`, `watchedTurn`, `queued`, `permissions`, `terminals`), each with the comment its declaration carries today (about 120 lines).
- `CREATE: packages/agent-acp/src/session/common.ts` - `bag` (66), `UNTITLED` (68-69), `messageOf` (374) (about 10 lines).
- `UPDATE: packages/agent-acp/src/session.ts:66-69,255-398` - those removed; `acpSession` builds `const ctx = { ... } as SessionContext` holding the initializers, assigns `touch`, `doing` and `status` onto it, and every reader and writer of a shared field in the file uses `ctx.<name>`; `offers`, `listedModels`, `endpoint`, `asked`, `extras`, `signIns`, `activity`, `modified` and `draft` stay `let`s here.

## Steps

1. Move `bag`, `UNTITLED` and `messageOf` to `session/common.ts` unchanged, exported, and import them in `session.ts`.
2. Write `SessionContext` with each shared field's comment moved from its declaration, and the field typed as the `let` or `const` was.
3. Replace the 25 declarations with one `ctx` literal of their initializers, in today's order, and prefix every use in `session.ts` with `ctx.`; a `const` map or array may be taken off `ctx` once where `acpSession` begins.
4. `touch`, `doing` and `status` stay in `session.ts` and are assigned onto `ctx`, so every area reaches them there.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-acp` passes.
- The pure-move check in [plan.md](plan.md) prints only imports, exports and wiring (the field declarations, the `ctx` literal, the assignments of the funnel).
- `wc -l packages/agent-acp/src/session.ts` recorded.

## Resume

