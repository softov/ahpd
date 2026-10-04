---
title: The session's mutable state is one context
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L180-L406](../../../../packages/agent-cofold/src/session.ts#L180-L406) - the closure's state: the sixteen `let`s, the shared maps and lists, and `touch`"
  - "[code://packages/sdk/src/host/context.ts](../../../../packages/sdk/src/host/context.ts) - `HostContext`, the shape copied"
  - "[code://packages/sdk/src/host.ts#L707-L717](../../../../packages/sdk/src/host.ts#L707-L717) - `const ctx = { ... }`, the literal built once with the `as` idiom"
---

## Objective

`packages/agent-cofold/src/context.ts` exports `SessionContext`, `cofoldSession` builds one `ctx` of that type, and every `let` except `draft` is a field on it, read and written as `ctx.<name>`; no function has moved yet and nothing behaves differently.

## Files

- `CREATE: packages/agent-cofold/src/context.ts` - `SessionContext`, types only: `options`, `start`, `harness`, `provider`, `sessionId`, `where`, `store`, `turns`, `editing`, `pending`, `points`, `queued`, `settings`, `touch`, and the fields `offered`, `active`, `handle`, `liveAgent`, `activeMapping`, `paused`, `pausing`, `cancelRequested`, `failed`, `title`, `modified`, `closed`, `opening`, `refused`, `activity`.
- `UPDATE: packages/agent-cofold/src/session.ts:240-357` - the fifteen `let` declarations removed; their doc comments move to their fields in `context.ts`.
- `UPDATE: packages/agent-cofold/src/session.ts:406` - after `touch`, one `const ctx = { ... } as SessionContext` holding the constants and maps by shorthand and each moved `let`'s initial value.
- `UPDATE: packages/agent-cofold/src/session.ts` - every read and write of a moved `let` becomes `ctx.<name>`.

## Steps

1. Write `SessionContext` with one field per name above, its type the one the declaration has today, and move each `let`'s doc comment onto its field unchanged (`offered` 232-239, `handle` 245, `liveAgent` 247, `activeMapping` 249, `paused` 288-294, `pausing` 296-304, `cancelRequested` 319, `failed` 321, `opening` 326-335, `refused` 337-344, `activity` 356); give the interface one doc line saying what it is, as `HostContext` has.
2. Remove the fifteen `let`s and build `ctx` after `touch` (406); `draft` stays a local `let`, and `waiting` and `relay` stay where they are until task 02.
3. Prefix every use of a moved `let` with `ctx.`, including the writes in `touch`, `settleTurn`, `openTurn`, `runCommand`, `rejoin`, `reopen`, `owePause`, `payPause`, the opening block, `setTools`, `cancel` and `close`; leave the shadowing locals (`waiting` in `rejoin`, `route`, `stop`, `beginTurn`, and `pending` in the opening block) as they are.
4. Add `touch` to the context by shorthand, so the areas reach it as `ctx.touch`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-cofold` passes, all 13 files.
- The pure-move check in [plan.md](plan.md#the-pure-move-check) shows nothing removed and not put back, and the `>` side holds only wiring. The `<` side holds only the fifteen `let` declarations.
- `wc -l packages/agent-cofold/src/session.ts packages/agent-cofold/src/context.ts` recorded.

## Resume
