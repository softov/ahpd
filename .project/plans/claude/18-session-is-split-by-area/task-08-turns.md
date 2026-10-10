---
title: The turn lifecycle is a file of its own, and session.ts only composes
status: done
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

- **Implemented** 2026-10-04 on `build/agents/6a395779`.
- `session/turns.ts` (607 lines) created; `session/context.ts` is 262 and `session.ts` is 263, against the about 330 the task expected.
- `createTurns(ctx)` holds `queued`, `busy`, `carried`, `refuseTurn`, `beginTurn`, `startNext`, `runCommand` and the ten methods, and offers `queued`, `startNext` plus `methods: { begin, setTitle, ran, steer, queue, setDraft, unqueue, reorder, resume, cancel }`, spread into `self` as `...lifecycle.methods`. `busy`, `carried`, `refuseTurn`, `beginTurn` and `runCommand` are private to the factory.
- The factory's result is bound to `lifecycle` rather than `turns`, because `ctx.turns` is the list of finished turns and the two would otherwise read as the same thing three lines apart.
- `draft` and `beginning` are fields on `SessionContext` with the comments they had; `carried` stays a `let` inside the factory, read only by `beginTurn`, as step 2 asks.
- The `startNext` task 07 put on `ctx` is gone: `Turns` offers it. `ctx.startNext = startNext;` and the placeholder in the `ctx` literal were both removed, so no function is put on `ctx` from `session.ts` any more.
- `chatState` reads `ctx.queued` and `ctx.draft`; `...(ctx.draft !== undefined ? { draft: ctx.draft } : {})` is the one shape change, since the shorthand would name a local that no longer exists here.
- What is left in `session.ts` is what step 5 lists: the imports and re-exports, the module comment, `createSession` with the `ctx` literal, the factory calls, the construction statements in today's order (the stored model, `setShellInit`, `declared.ahp`, `startQuery`, `describe`, `consume`) and `self` (the state readers, the spreads, `close`). The orphaned `/** The client said the turn has begun ... */` above `close` is pre-existing on `main` and was left as it is.
- `session.ts` drops `ActiveTurn`, `ToolCallCompletedState`, `ToolCallRunningState`, `ToolResultTerminalContent`, `ToolResultTextContent`, `Chosen`, `MessageFrom`, `OnWire`, `Ran`, `WireTurn` and the `EFFORTS` value import; `turns.ts` takes them. `EFFORTS` is still re-exported from `session.ts`, and `Published` still is, since `index.ts` imports it from `../session.js`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm exec vitest run packages/agent-claude` (19 files, 169 tests) and the whole `pnpm test` suite (186 files, 2,839 tests) pass.
- Pure-move check against the commit task 01 started from, over the whole `git diff` and every file under `session/`: 55 removed lines do not reappear among the added ones with indentation, `export ` and `ctx.` stripped. All 55 are accounted for - ten import lines, the three `common.ts` helpers, the twenty-five `let`s that became `SessionContext` fields, and fifteen lines that had to be rewritten rather than moved: a stray `},`, `emit('session', { type: 'session/titleChanged', title })`, `title,`, `cwd,`, the two `UUID.test(idOf(uri))` lines, `canUseTool,`, `chat: chatUri,`, the `customizationsChanged` emit, `status,`, `chats: [{ resource: chatUri, title }],`, `customizations,`, `...(activity !== undefined ? { activity } : {}),`, `...(draft !== undefined ? { draft } : {}),` and `stopWorker: (toolCallId) => {`. No other line of the original moved or changed.
- `wc -l`: `session.ts` 263, and under `session/` the largest is `turns.ts` at 607 and `stream.ts` at 600. Nothing is over 700.
