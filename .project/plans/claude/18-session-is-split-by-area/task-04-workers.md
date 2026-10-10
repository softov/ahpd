---
title: Subagents and their chats are a file of their own
status: done
depends: [task-03-turn-parts.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L991-L1000](../../../../packages/agent-claude/src/session.ts#L991-L1000) - `parts`, `calling`, the main scope's maps"
  - "[code://packages/agent-claude/src/session.ts#L1019-L1359](../../../../packages/agent-claude/src/session.ts#L1019-L1359) - `Scope`, `mainScope`, `scopes`, `Spawning`, `spawning`, `background`, `tasks`, `byAgent`, `ended`, `dropped`, `SPAWN_GRACE`, `scopeFor`, `openWorker`, `releaseHeld`, `recordSpawn`, `scopeOfCall`, `emitOn`, `settleOpen`, `endWorker`"
  - "[code://packages/agent-claude/src/session.ts#L2241-L2259](../../../../packages/agent-claude/src/session.ts#L2241-L2259) - `workerBlock`"
  - "[code://packages/agent-claude/src/session.ts#L3982-L3998](../../../../packages/agent-claude/src/session.ts#L3982-L3998) - method `stopWorker`, which calls `self.cancel('')`"
---

## Objective

`session/workers.ts` exports `createWorkers(ctx)`, which holds the scopes a frame lands in and every subagent's record and chat, offers them and returns the `stopWorker` method, unchanged.

## Files

- `CREATE: packages/agent-claude/src/session/workers.ts` - `parts`, `calling` (991-1000), `Scope` and `Spawning` exported as types, everything in 1019-1359, `workerBlock` (2241-2259), and `stopWorker` (3982-3998) in its `methods` table.
- `UPDATE: packages/agent-claude/src/session/context.ts` - `extends Workers`; field `streaming` and `self`; `rounds` and `pastLines` until task 05; `mainScope` and `emitOn` are now offered by `Workers`.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; `Object.assign(ctx, createWorkers(ctx))`; `ctx.self = self` once `self` is built.

## Steps

1. Move each declaration with its comment, unchanged but for indentation, `export` and `ctx.`.
2. `streaming` becomes a field; `mainScope`'s getter and setter for `streaming` read and write `ctx.streaming`, and `consume` clears `ctx.streaming`.
3. `parts` and `calling` stay the same two maps `mainScope` holds and `consume` clears and `refreshMcp` reads, offered on `ctx`.
4. `scopes`, `spawning`, `background`, `tasks`, `byAgent` and `ended` are offered on `ctx` for `results`, `consume`, `canUseTool`, `cancel` and `close`.
5. `self.cancel('')` in `stopWorker` reads `ctx.self.cancel('')`.
6. `rounds` and `pastLines` are still in `session.ts` and `endWorker` and `settleOpen` read them, so `session.ts` puts them on `ctx` until task 05.
7. The `mainScope` and `emitOn` that task 03 put on `ctx` from `session.ts` are removed.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `agent-claude-subagent.test.ts`, `agent-claude-subagent-restore.test.ts` and `agent-claude-close.test.ts` cover worker chats, held frames and their release.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines and the `let` declaration that became a field; the same two lists with `comm -13` show the added lines that are new, which are only imports, the factory signature, the `Workers` interface, `SessionContext` fields and the `ctx` assignments.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*.

## Resume

- **Implemented** 2026-10-04 on `build/agents/6a395779`.
- `session/workers.ts` (423 lines) created; `session/context.ts` is 202 and `session.ts` is 2,757.
- `createWorkers(ctx)` offers the maps the task names - `parts`, `calling`, `mainScope`, `scopes`, `spawning`, `background`, `tasks`, `byAgent`, `ended` - and with them the eight functions the rest of `session.ts` calls: `scopeFor`, `releaseHeld`, `recordSpawn`, `scopeOfCall`, `emitOn`, `settleOpen`, `endWorker`, `workerBlock`. The task's step 4 names only the maps; the functions have to be offered as well or nothing outside the factory can reach them, and the plan's list of *added* lines ("imports, the factory signature, the `Workers` interface, `SessionContext` fields and the `ctx` assignments") is satisfied either way - they are interface entries, not new code. `dropped` and `SPAWN_GRACE` stay private to the factory, as does `openWorker`, which nothing outside calls.
- `mainScope`'s getter and setter for `streaming` read and write `ctx.streaming`, and `streaming` is a field; `ctx.self` is set once `self` is built, so `stopWorker` calls `ctx.self.cancel('')`.
- `rounds` and `pastLines` stay declared in `session.ts` with their comments and are put on `ctx` by an assignment, as task 03 did `pending`.
- **Departure 5.** `Scope` is still declared and exported by `session/context.ts`; `workers.ts` imports it and re-exports the type, so the task's "`Scope` and `Spawning` exported as types" holds without a second copy of the interface. `Spawning` moved to `workers.ts`, where it is declared.
- `SessionContext` now extends `Omit<Workers, 'methods'>` as well, and declares `streaming`, `rounds`, `pastLines` and `self`.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-claude` (19 files, 169 tests) pass.
- Pure-move check over the cumulative `git diff` plus the new files: the unmatched removed lines are the imports, the declarations that became fields, the shorthand `title,` / `status,` / `chats:` / `...(activity ...)` lines that became `ctx.`-prefixed reads, `emit('session', { type: 'session/titleChanged', title })`, and `stopWorker: (toolCallId) => {`, which is `const stopWorker = (toolCallId: string): void => {` in the factory.
