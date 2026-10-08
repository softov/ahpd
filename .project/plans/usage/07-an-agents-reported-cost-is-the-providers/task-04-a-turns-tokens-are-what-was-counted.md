---
title: A turn's tokens are what the provider counted
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L92-L120](../../../../packages/agent-claude/src/session/parts.ts#L92-L120) - `usageOf`, which reads a message's usage"
---

## Objective

A Claude turn through OpenRouter records the input tokens OpenRouter counted, or no input when none was reported, never 0 beside an output.

## Files

- `UPDATE: packages/agent-claude/src/session/parts.ts` - where the cause is.
- `UPDATE: packages/agent-claude/test/` - a test from a captured message.

## Steps

1. Capture the stream of a `claude-openrouter` turn: the `message_start` and `message_delta` usage, and the CLI's `result`.
2. Find where the 0 comes from: OpenRouter's `message_start`, the CLI, or `usageOf`.
3. If the count is in the stream, read it from there. If nothing reports it, record the input as absent.

## Validation

- A test from the capture: the record's input is the count, or absent.
- `npx vitest run packages/agent-claude` passes.

## Resume

