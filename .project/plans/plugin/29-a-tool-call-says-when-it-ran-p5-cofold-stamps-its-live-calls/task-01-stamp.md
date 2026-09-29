---
title: cofold tool calls carry their start and end live too, and restored calls keep their kind
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L496-535](../../../../packages/agent-cofold/src/mapping.ts#L496-535) - live mapping drops `at` and `durationMs`"
  - "[code://packages/agent-cofold/src/transcript.ts#L106-217](../../../../packages/agent-cofold/src/transcript.ts#L106-217) - restored calls: times present, `toolKind` lost because `callPartOf` does not merge `toolMetaOf`"
---

## Objective

Live, a call's `_meta` takes the event `at` as start and end and `tool.completed`'s `durationMs`. Restored, a call keeps its `toolKind` beside the times it already has.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1.

## Validation

- A live call carries the three keys; a restored call carries `toolKind` and the three keys.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
