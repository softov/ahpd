---
title: A turn's tokens are what the provider counted
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L92-L120](../../../../packages/agent-claude/src/session/parts.ts#L92-L120) - `usageOf`, which reads a message's usage"
---

## Objective

A Claude turn records the input tokens the provider counted, or no input when it reported 0 beside an output.

## Files

- `UPDATE: packages/agent-claude/src/session/parts.ts` - where the cause is.
- `UPDATE: packages/agent-claude/test/` - a test from a captured message.

## Steps

1. Find where `usageOf` in `packages/agent-claude/src/session/parts.ts` sets the input.
2. Leave the input absent when it is 0, with no cache read or write and an output above 0.
3. Keep an input of 0 when the output is also 0.
4. Write the tests below from made-up messages in the shape of a `message_start` and a `result`.

## Validation

- A test: input 0, no cache and output 6 gives a record with no input.
- A test: input 0 with a cache read gives an input of 0.
- A test: input 10 and output 6 gives an input of 10.
- `npx vitest run packages/agent-claude` passes.

## Resume

2026-10-09. The 77 records with input 0 all came from `stealth/space-bunny-alpha` through OpenRouter. OpenRouter now answers "No endpoints found" for it, so no capture is possible. `anthropic/claude-sonnet-4` through OpenRouter reports input and cache.

2026-10-09: `usageOf` leaves out an uncounted input of 0, with five cases in `agent-claude-usage.test.ts`. Merged after review.
