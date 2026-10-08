---
title: The session's shared state is one context
status: done
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

- Done: `session/common.ts` (`bag`, `UNTITLED`, `messageOf`) and `session/context.ts` (`SessionContext`, 118 lines) created; the 25 shared fields are now `ctx` fields, the funnel is in the literal, and `acpSession` reads and writes them as `ctx.<name>`. `offers`, `listedModels`, `endpoint`, `asked`, `extras`, `signIns`, `activity`, `modified` and `draft` stayed `let`s in `session.ts`.
- Gates: `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm exec vitest run packages/agent-acp/test` 146/146.
- `wc -l packages/agent-acp/src/session.ts` 2054 (was 2105); `session/context.ts` 118, `session/common.ts` 9.
- Pure-move check: 29 lines, all wiring - the 25 field declarations that became fields, and the three `title` sites in `runCommand`, `begin` and `setTitle` that now read `ctx.title`.
- Departures, both forced:
  - `touch`, `doing` and `status` go into the `ctx` literal rather than being assigned onto it afterwards. `as SessionContext` rejects a literal missing those three (TS2352), and a type annotation would reject it too. They are still defined in `session.ts` and reached through `ctx`; only the three `ctx.x = x` lines are gone. `status` reads `ctx.permissions` rather than a destructured `permissions`, because the destructuring follows the literal.
  - `modes` (was 263-270) is in the enumerated 25 shared fields but in no line range of the plan's *Proposed architecture* table. It crosses files (config's `schemaOf`, handlers' `receivedUpdate`, opening's `learnModes`), so it became a field on `SessionContext`, as the enumerations decide.
- `active`, `closed` and `title` carry no comment on the context: they had none at the declaration, and this task adds none.
- Next: [task-02-config-and-models.md](task-02-config-and-models.md).

