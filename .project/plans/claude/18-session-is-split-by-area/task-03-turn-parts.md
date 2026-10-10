---
title: What a turn holds is a file of its own
status: done
depends: [task-02-context-config-and-client-tools.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1446-L1461](../../../../packages/agent-claude/src/session.ts#L1446-L1461) - `touch`, `doing`"
  - "[code://packages/agent-claude/src/session.ts#L1479-L1490](../../../../packages/agent-claude/src/session.ts#L1479-L1490) - `busyWith`, `retitle`"
  - "[code://packages/agent-claude/src/session.ts#L1492-L1598](../../../../packages/agent-claude/src/session.ts#L1492-L1598) - `usageOf`, `spent`, `newTurn`, `count`, `sum`, `sayUsage`, `paid`, `costOf`"
  - "[code://packages/agent-claude/src/session.ts#L1600-L1620](../../../../packages/agent-claude/src/session.ts#L1600-L1620) - `status`, `inputNeededSet`, `inputNeededRemoved`"
  - "[code://packages/agent-claude/src/session.ts#L1622-L1730](../../../../packages/agent-claude/src/session.ts#L1622-L1730) - `openTurn`, `addPart`, `holdPart`, `stampStart`, `stampEnd`, `untimed`, `failurePart`, `addFailure`"
  - "[code://packages/agent-claude/src/session.ts#L1052-L1061](../../../../packages/agent-claude/src/session.ts#L1052-L1061) - `mainScope`, whose getters read `active` and so follow it onto the context"
---

## Objective

`session/parts.ts` exports `createParts(ctx)`, which offers the functions every other area uses to open a turn, add a part, stamp a call's times, count usage and say what the session is doing, unchanged.

## Files

- `CREATE: packages/agent-claude/src/session/parts.ts` - `touch` (1446), `doing` (1448-1461), `busyWith` (1479-1482), `retitle` (1484-1490), `usageOf` to `costOf` (1492-1598), `status` (1600-1603), `inputNeededSet` and `inputNeededRemoved` with the comments above them (1605-1620), `openTurn` to `addFailure` (1622-1730); `spent` and `paid` stay local to the factory.
- `UPDATE: packages/agent-claude/src/session/context.ts` - `extends Parts`; fields `active`, `title`, `modified`, `activity`, `startedAt`, `failed`, `ran`, with the comments of `failed`, `ran` and `activity`; `pending`, `mainScope` and `emitOn` until their tasks move them; `doing` is now offered by `Parts`.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; `Object.assign(ctx, createParts(ctx))`; every use of the seven `let`s above is `ctx.<name>`.

## Steps

1. Move each function with its comment, unchanged but for indentation, `export` and `ctx.`; the separator `// --- translation` at 1622 moves with `openTurn`.
2. `active`, `title`, `modified`, `activity`, `startedAt`, `failed` and `ran` become fields; every reader and writer left in `session.ts` (`assistant`, `results`, `consume`, `beginTurn`, `runCommand`, `refuseTurn`, `resume`, `cancel`, `self`) uses `ctx.<name>`.
3. `mainScope`'s getter and setter read and write `ctx.active`; it stays the same object, in `session.ts`, until task 04.
4. `pending`, `mainScope` and `emitOn` are still in `session.ts` and `status` and `openTurn` read them, so `session.ts` puts them on `ctx`.
5. The `doing` that task 02 put on `ctx` from `session.ts` is removed; `createParts` offers it.
6. `self.status`, `sessionState` and `chatState` call `ctx.status()`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `agent-claude-usage.test.ts`, `agent-claude-round-ended.test.ts`, `agent-claude-turn-recorded.test.ts` and `agent-claude-tool-input.test.ts` cover usage, opened turns, parts and the call times.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines and the `let` declarations that became fields; the same two lists with `comm -13` show the added lines that are new, which are only imports, the factory signature, the `Parts` interface, `SessionContext` fields, the `ctx` literal entries and the `ctx` assignments.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*.

## Resume

- **Implemented** 2026-10-04 on `build/agents/6a395779`.
- `session/parts.ts` (328 lines) created; `session/context.ts` is 196 and `session.ts` is 3,109.
- `createParts(ctx)` offers twenty functions; `spent` and `paid` stay in the factory, and `failurePart` stays with `addFailure` because nothing else calls it. `edits` stays in `session.ts` - it sits between `doing` and `busyWith` in the file but is not in this task's list.
- `ctx.parts` is `Object.assign`ed in `createSession`; `ctx.pending`, `ctx.mainScope` and `ctx.emitOn` are put on the context where each is still declared, and `mainScope`'s getter and setter read and write `ctx.active`.
- `self.status` is `status: () => ctx.status()` and `sessionState` and `chatState` say `status: ctx.status()`, as the task asks.
- **Departure 3.** `emit` became a context field. `parts.ts` emits from `touch`, `doing`, `retitle`, `sayUsage`, `inputNeededSet` and `inputNeededRemoved`, and the plan's field list does not name `emit`; without it those lines would have read `ctx.options.emit` and the pure-move check would have shown six changed lines. With the field they read `ctx.emit` and are otherwise unchanged. `session.ts` keeps its own destructured `emit`.
- **Departure 4.** The `Scope` and `PendingInput` interfaces moved to `session/context.ts` and are exported from there (`Scope`, `PendingInput` is private). `openTurn` and `addPart` take a `Scope` and `ctx.pending` is a `Map<string, PendingInput>`, so both types have to be visible to `parts.ts`; the plan does not say where they go. Task 06 moves `PendingInput` on with `pending` itself.
- Three `let`s that shadow a field name - `ran` in the tool result handler, `title` in `workerBlock`, `status` in the `task_notification` branch - keep their own names. Caught by the test gates, not by the type checker.
- `session.ts` drops `summarize`, `callTimes`, `startOf` and `withCallTimes` from its imports.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-claude` (19 files, 169 tests) pass.
- Pure-move check over the cumulative `git diff` plus the new files: the unmatched removed lines are the imports, the declarations that became fields, and the four shorthand `status,` / `title,` / `chats:` / `...(activity ...)` lines that became `ctx.`-prefixed reads, plus `emit('session', { type: 'session/titleChanged', title })`, whose shorthand had no `title` in scope to name.
