---
title: A turn's pick is taken or refused
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L54](../../../../packages/agent-pi/src/backend.ts#L54) - `choose` in the backend's contract"
  - "[code://packages/agent-pi/src/session.ts#L826](../../../../packages/agent-pi/src/session.ts#L826) - the turn's `choose`, inside the try whose catch fails the turn"
  - "[code://packages/agent-pi/src/session.ts#L686](../../../../packages/agent-pi/src/session.ts#L686) - the configured model at open, which keeps falling back"
  - "[code://packages/agent-pi/src/session.ts#L750](../../../../packages/agent-pi/src/session.ts#L750) - the carried model on a rebuild, which keeps falling back"
---

## Objective

`choose` says whether it resolved the id (for example by returning `false`), and the turn path at session.ts:826 fails the turn with `pi has no model <id>` when it did not, before `prompt`; the other two callers ignore the answer as they do today.
The comment on `choose` about running a stale pick is rewritten to say what it does now.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts` - `choose`'s contract and body.
- `UPDATE: packages/agent-pi/src/session.ts` - the turn's call.
- `UPDATE: packages/agent-pi/test/` fakes of the backend that implement `choose`.

## Validation

- `packages/agent-pi/test/`: a turn naming an id the fake cannot resolve ends in error naming it, nothing is prompted, and a following turn with no model runs on the previous one; a resolvable id runs as today; an unresolvable configured `model` still opens the session.

## Resume
