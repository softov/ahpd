---
title: The turn waits for the model switch
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2308](../../../../packages/agent-claude/src/session.ts#L2308) - `beginTurn`, synchronous today"
  - "[code://packages/agent-claude/src/session.ts#L2310-L2352](../../../../packages/agent-claude/src/session.ts#L2310-L2352) - the exited-CLI path: a turn started and failed at once, the shape to reuse"
---

## Objective

When a turn names a model other than `chosen`, `setModel` is awaited before the prompt goes out; if it rejects, the turn is recorded as started and failed with `The harness would not take model <id>: <reason>`, the prompt is not sent, and `chosen` keeps its value.
The effort level from the same `ModelSelection` is applied only after the model is taken.
Turns that start while the switch is pending wait behind it, so two turns cannot reach the CLI out of order.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - `beginTurn` and its two callers.
- `CREATE: packages/agent-claude/test/agent-claude-model-refusal.test.ts` - the cases below.

## Validation

- `packages/agent-claude/test/`: with a stub handle whose `setModel` rejects, the turn emits `chat/turnStarted` then `chat/error` naming the model and reason, no prompt is pushed, and a following turn carries the previous model; with one that resolves, the turn carries the new model as today.

## Resume
