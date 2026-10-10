---
title: Asking a person is a file of its own
status: done
depends: [task-05-stream.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L113-L192](../../../../packages/agent-claude/src/session.ts#L113-L192) - `PendingInput`, `KEPT_IN`, `keptLabel`"
  - "[code://packages/agent-claude/src/session.ts#L719-L732](../../../../packages/agent-claude/src/session.ts#L719-L732) - `pending`"
  - "[code://packages/agent-claude/src/session.ts#L2261-L2426](../../../../packages/agent-claude/src/session.ts#L2261-L2426) - `settled`, `canUseTool`"
  - "[code://packages/agent-claude/src/session.ts#L3005-L3013](../../../../packages/agent-claude/src/session.ts#L3005-L3013) - `answeredInputs`"
  - "[code://packages/agent-claude/src/session.ts#L4000-L4053](../../../../packages/agent-claude/src/session.ts#L4000-L4053) - method `confirm`"
  - "[code://packages/agent-claude/src/session.ts#L4107-L4201](../../../../packages/agent-claude/src/session.ts#L4107-L4201) - methods `setAnswer`, `answer`"
  - "[code://packages/agent-claude/test/kept-label.test.ts#L3](../../../../packages/agent-claude/test/kept-label.test.ts#L3) - imports `keptLabel` from `../src/session.js`"
---

## Objective

`session/asking.ts` exports `createAsking(ctx)`, which holds every question and tool confirmation the session is waiting on, offers `pending`, `canUseTool` and `answeredInputs`, and returns the `confirm`, `setAnswer` and `answer` methods, unchanged.

## Files

- `CREATE: packages/agent-claude/src/session/asking.ts` - module-level `PendingInput` (exported type), `KEPT_IN`, `keptLabel`; `createAsking(ctx)` with `pending`, `settled`, `canUseTool`, `answeredInputs` and the three methods.
- `UPDATE: packages/agent-claude/src/session/context.ts` - `extends Asking`; `pending` and `answeredInputs` are now offered by `Asking`.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; `Object.assign(ctx, createAsking(ctx))`; re-exports `keptLabel`; the method table spread into `self`.

## Steps

1. Move each declaration and method with its comment, unchanged but for indentation, `export` and `ctx.`; the separator `// --- asking a person` at 2261 moves with `settled`.
2. `canUseTool` reads `ctx.allowed` on every call, which is what makes a list set mid-session take effect.
3. `startQuery` passes `canUseTool: ctx.canUseTool`; the query is built after every factory, so the function is there when it is read.
4. `sessionState`, `cancel` and `close` read `ctx.pending`.
5. The `pending` and `answeredInputs` that tasks 03 and 05 put on `ctx` from `session.ts` are removed.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `kept-label.test.ts` covers `keptLabel` through `../src/session.js`, and `agent-claude-tool-input.test.ts` and `agent-claude-subagent.test.ts` cover confirmations and a worker's ask.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines and the `canUseTool,` shorthand in `startQuery`; the same two lists with `comm -13` show the added lines that are new, which are only imports, the factory signature, the `Asking` interface and the spread into `self`.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*.

## Resume

- **Implemented** 2026-10-04 on `build/agents/6a395779`.
- `session/asking.ts` (447 lines) created; `session/context.ts` is 181 and `session.ts` is 1,763.
- Module-level `PendingInput` (exported), `KEPT_IN` and `keptLabel` moved to the file; `keptLabel` is re-exported from `session.ts`, so `kept-label.test.ts` still imports it from `../src/session.js` and nothing in `packages/agent-claude/test` changed.
- `createAsking(ctx)` offers `pending`, `answeredInputs` and `canUseTool` and returns `methods: { confirm, setAnswer, answer }`, spread into `self` as `...asking.methods`. `settled` stays private to the factory.
- The `PendingInput` interface that task 03 put in `session/context.ts` moved on to `asking.ts`, as this task asks; `context.ts` no longer declares `pending`, `answeredInputs` or `PendingInput`.
- `startQuery` passes `canUseTool: ctx.canUseTool`. `session.ts` keeps its own `const asking = createAsking(ctx)` next to `config`, `clientTools` and `workers` and assigns that, rather than calling the factory twice.
- **Departure 6.** `const where = scope.chat?.uri ?? chatUri;` in `canUseTool` reads `ctx.options.chatUri`. `chatUri` is a destructured local of `createSession` and the plan does not name it as a context field; without this the line would have been a third spelling of the same thing and the pure-move check would have shown it changed.
- `session.ts` drops `lineOf`, `pastLineOf`, `questionRequest`, `toolInputOf` and `toolMetaOf` from its imports; `asking.ts` takes them.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-claude` (19 files, 169 tests) pass.
- Pure-move check over the cumulative `git diff` plus the new files: 30 unmatched removed lines, the previous 27 plus `import { toolMetaOf } from './kinds.js';`, `const where = scope.chat?.uri ?? chatUri;` and `canUseTool,` - the last being the shorthand the task's own Validation predicts.
