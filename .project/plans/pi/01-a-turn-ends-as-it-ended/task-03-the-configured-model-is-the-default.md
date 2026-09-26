---
title: The configured model is the default
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/types.ts#L23-L28](../../../../packages/agent-pi/src/types.ts#L23-L28) - `PiOptions.model`: the model a session runs on when nobody chooses"
  - "[code://packages/agent-pi/src/plugin.ts#L57-L58](../../../../packages/agent-pi/src/plugin.ts#L57-L58) - parsed from the configuration, and read nowhere after"
  - "[code://packages/agent-pi/src/session.ts#L238-L274](../../../../packages/agent-pi/src/session.ts#L238-L274) - `opened`, where the model list is first known"
  - "[code://packages/agent-pi/src/backend.ts#L139-L159](../../../../packages/agent-pi/src/backend.ts#L139-L159) - `choose`, which already resolves a wire id and keeps the current model for one it cannot"
  - "[code://packages/agent-pi/README.md#L22-L30](../../../../packages/agent-pi/README.md#L22-L30) - the options table, which does not list `model`"
---

## Objective

A new pi session with `model` configured runs on that model until a turn chooses another.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:238-274` - in `opened`, after the model list is read and before the rewind, `backend.choose(options.model)` for a session that is not resumed or forked.
- `UPDATE: packages/agent-pi/README.md:22-30` - a `model` row in the options table, in the file's own style.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. Apply `options.model` only when `start.resume` is unset: a resumed session keeps the model its own file recorded.
2. A turn's own `model` still wins, since `begin` calls `choose` after `opened`.
3. An id `choose` cannot resolve leaves pi's own default, as `choose` already does for a stale pick.

## Validation

- `test/agent-pi.test.ts`: a new session with `{ model: 'openai/gpt-5' }` asks the fake to choose it on open; a resumed one does not; a turn with its own model asks for that one after.
- `pnpm test`, `pnpm typecheck` green.

## Resume
