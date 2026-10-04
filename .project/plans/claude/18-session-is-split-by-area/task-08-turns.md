---
title: The turn lifecycle is a file of its own, and session.ts only composes
status: todo
depends: [task-07-query-and-servers.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L787-L795](../../../../packages/agent-claude/src/session.ts#L787-L795) - `queued`"
  - "[code://packages/agent-claude/src/session.ts#L825-L836](../../../../packages/agent-claude/src/session.ts#L825-L836) - `beginning`, which becomes a field, and `busy`"
  - "[code://packages/agent-claude/src/session.ts#L2620-L2629](../../../../packages/agent-claude/src/session.ts#L2620-L2629) - `carried`, with the comment above it"
  - "[code://packages/agent-claude/src/session.ts#L2652-L2686](../../../../packages/agent-claude/src/session.ts#L2652-L2686) - `refuseTurn`"
  - "[code://packages/agent-claude/src/session.ts#L2737-L2895](../../../../packages/agent-claude/src/session.ts#L2737-L2895) - `beginTurn`, `startNext`"
  - "[code://packages/agent-claude/src/session.ts#L3339-L3449](../../../../packages/agent-claude/src/session.ts#L3339-L3449) - `runCommand`"
  - "[code://packages/agent-claude/src/session.ts#L3738-L3980](../../../../packages/agent-claude/src/session.ts#L3738-L3980) - methods `begin`, `setTitle`, `ran`, `steer`, `queue`, `setDraft`, `unqueue`, `reorder`, `resume`, `cancel`"
---

## Objective

`session/turns.ts` exports `createTurns(ctx)`, which starts, refuses, queues, steers, resumes and cancels a turn, offers `startNext` and `queued`, and returns those methods, unchanged; `session.ts` is left holding only the context, the factory calls, the construction statements and `self`.

## Files

- `CREATE: packages/agent-claude/src/session/turns.ts` - `createTurns(ctx)` with `queued`, `busy`, `carried`, `refuseTurn`, `beginTurn`, `startNext`, `runCommand` and the ten methods.
- `UPDATE: packages/agent-claude/src/session/context.ts` - `extends Turns`; fields `draft` and `beginning` with their comments; `startNext` is now offered by `Turns`.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; `Object.assign(ctx, createTurns(ctx))`; the method table spread into `self`; `chatState` reads `ctx.queued` and `ctx.draft`.

## Steps

1. Move each declaration and method with its comment, unchanged but for indentation, `export` and `ctx.`; the comment at 2620-2627 moves with `carried`, where it sits.
2. `draft` and `beginning` become fields; `carried` is read only by `beginTurn`, so it stays a `let` inside `createTurns`.
3. `beginTurn` calls `ctx.switchAgent` and `ctx.take`; `cancel` calls `ctx.releaseCalls`, `ctx.releaseHeld`, `ctx.endWorker` and `ctx.settleOpen`; `stopWorker` reaches `cancel` through `ctx.self`.
4. The `startNext` that task 07 put on `ctx` from `session.ts` is removed, and no function is put on `ctx` from `session.ts` any more.
5. Check what is left in `session.ts`: the imports and re-exports, the module comment, `createSession` with the `ctx` literal, the factory calls, the construction statements in today's order (the stored model, `setShellInit`, `declared.ahp`, `startQuery`, `describe`, `consume`), and `self` (the state readers, the spreads, `close`).

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `agent-claude-model-refusal.test.ts`, `agent-claude-agent-pick.test.ts`, `agent-claude-close.test.ts` and `agent-claude-subagent.test.ts` cover a refused turn, the queue behind a switch, a cancel and the workers it ends.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines and the `let` declarations that became fields; the same two lists with `comm -13` show the added lines that are new, which are only imports, the factory signature, the `Turns` interface, `SessionContext` fields and the spread into `self`.
- The same check run against the commit task 01 started from prints only imports, exports and context wiring for the whole plan.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*: `session.ts` under 1,000 (about 330 expected) and no file under `session/` over 700.

## Resume
