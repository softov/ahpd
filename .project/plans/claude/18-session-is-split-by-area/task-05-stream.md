---
title: The stream translation is a file of its own
status: todo
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
