---
title: What a turn holds is a file of its own
status: todo
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
