---
title: The stream translation is a file of its own
status: implemented
depends: [task-04-workers.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L68-L77](../../../../packages/agent-claude/src/session.ts#L68-L77) - `INPUT_SIDE`, `OUTPUT_SIDE`"
  - "[code://packages/agent-claude/src/session.ts#L194-L198](../../../../packages/agent-claude/src/session.ts#L194-L198) - `resultText`"
  - "[code://packages/agent-claude/src/session.ts#L899-L907](../../../../packages/agent-claude/src/session.ts#L899-L907) - `serverOf`"
  - "[code://packages/agent-claude/src/session.ts#L1002-L1017](../../../../packages/agent-claude/src/session.ts#L1002-L1017) - `rounds`"
  - "[code://packages/agent-claude/src/session.ts#L1463-L1477](../../../../packages/agent-claude/src/session.ts#L1463-L1477) - `edits`, with the stray line above its comment"
  - "[code://packages/agent-claude/src/session.ts#L1732-L2239](../../../../packages/agent-claude/src/session.ts#L1732-L2239) - `streamed`, `assistant`, `results`"
  - "[code://packages/agent-claude/src/session.ts#L2999-L3003](../../../../packages/agent-claude/src/session.ts#L2999-L3003) - `editing`, `pastLines`"
---

## Objective

`session/stream.ts` exports `createStream(ctx)`, which offers `streamed`, `assistant` and `results`, the three functions that turn the SDK's frames into chat actions, unchanged.

## Files

- `CREATE: packages/agent-claude/src/session/stream.ts` - module-level `INPUT_SIDE`, `OUTPUT_SIDE`, `resultText`; `createStream(ctx)` with `serverOf`, `rounds`, `edits`, `streamed`, `assistant`, `results`, `editing`, `pastLines`, offering `streamed`, `assistant`, `results`, `rounds` and `pastLines`.
- `UPDATE: packages/agent-claude/src/session/context.ts` - `extends Stream`; `onServer` and `answeredInputs` until their tasks move them; `rounds` and `pastLines` are now offered by `Stream`.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; `Object.assign(ctx, createStream(ctx))`; `consume` calls `ctx.streamed`, `ctx.assistant`, `ctx.results`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation, `export` and `ctx.`; the line at 1463 moves with `edits`, where it sits.
2. `assistant` writes `ctx.ran`; `results` declares its own `const ran`, which shadows nothing once the outer one is `ctx.ran`, and stays as it is.
3. `onServer` and `answeredInputs` are still in `session.ts` and the moved code reads them, so `session.ts` puts them on `ctx` until tasks 07 and 06.
4. The `rounds` and `pastLines` that task 04 put on `ctx` from `session.ts` are removed.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `agent-claude-round-ended.test.ts`, `agent-claude-tool-input.test.ts`, `agent-claude-usage.test.ts` and `agent-claude-subagent.test.ts` drive frames through all three functions.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines; the same two lists with `comm -13` show the added lines that are new, which are only imports, the factory signature, the `Stream` interface, `SessionContext` fields and the `ctx` assignments.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*.

## Resume

- **Implemented** 2026-10-04 on `build/agents/6a395779`.
- `session/stream.ts` (600 lines) created; `session/context.ts` is 215 and `session.ts` is 2,184.
- Module-level `INPUT_SIDE`, `OUTPUT_SIDE` and `resultText` sit at the top of the file; the factory holds `serverOf`, `rounds`, `editing`, `pastLines`, `edits` and the three functions, and offers `streamed`, `assistant`, `results`, `rounds` and `pastLines`. `serverOf`, `editing` and `edits` are private: nothing outside the factory calls them.
- The stray `/** One line for a tool that is running. The name alone says too little. */` that task 03 left in `session.ts` above `edits` moved with it, as the task's ref says.
- `onServer` and `answeredInputs` stay declared in `session.ts` and are put on `ctx` by an assignment, until tasks 07 and 06 take them.
- `results` keeps its own `const ran = call.status !== 'cancelled'`, which shadows nothing now that the session's is `ctx.ran`; `assistant` writes `ctx.ran`.
- `SessionContext` extends `Stream` and no longer declares `rounds` or `pastLines` itself.
- `session.ts` drops `titleOf`, `StringOrMarkdown`, `ToolResultContent` and `SubagentChat` from its imports; `stream.ts` adds `toolMetaOf`, `OnWire`, `ToolCallCompletedState`, `ToolCallRunningState`, `ToolResultContent` and `StringOrMarkdown`.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-claude` (19 files, 169 tests) pass.
- Pure-move check over the cumulative `git diff` plus the new files: the same 27 unmatched removed lines as after task 04 - the imports, the declarations that became fields, the four shorthand lines that became `ctx.`-prefixed reads, `emit('session', { type: 'session/titleChanged', title })` and `stopWorker: (toolCallId) => {`. Nothing new from this task.
