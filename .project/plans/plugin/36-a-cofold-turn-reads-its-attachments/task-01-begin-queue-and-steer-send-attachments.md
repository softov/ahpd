---
title: begin, queue and steer send their attachments to the run
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/turns.ts#L120-L127](../../../../packages/agent-cofold/src/turns.ts#L120-L127) - the run's input"
---

## Objective

`begin`, `queue` and `steer` carry attachments; the run's `input` is `partsOf`'s parts as `ContentPart[]` when there are any.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:288`, `:307-316`.
- `UPDATE: packages/agent-cofold/src/turns.ts` - `beginTurn`, `queue`, `startNext`, the `run` call.
- `UPDATE: packages/agent-cofold/test/` - the attachment cases.

## Steps

1. Read `features.images` from the model the turn resolves.
2. A text part is a `TextPart`; an image part an `ImagePart` with `data`.
3. The turn's and the entry's `message` keep the attachments.

## Validation

- The plan's checklist.

## Resume
