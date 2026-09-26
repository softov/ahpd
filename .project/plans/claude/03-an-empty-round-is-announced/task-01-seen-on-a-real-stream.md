---
title: An empty round seen on a real stream
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1052-L1060](../../../../packages/agent-claude/src/session.ts#L1052-L1060) - where the stream events arrive"
---

## Objective

A captured Claude stream shows a model message that has thinking and no text or tool use, ending with `message_stop`, or shows that the CLI never sends one.

## Files

- `CREATE: test/fixtures/claude-empty-round.jsonl` - the captured `stream_event`s of one such turn, trimmed to what the test needs.

## Steps

1. Run the daemon from the checkout with `--wire <file>` and a Claude session with extended thinking on.
2. Ask for work that uses a tool and then needs no reply (for example "read package.json and say nothing"), until a message with only a thinking block appears between `message_start` and `message_stop`.
3. Save the events of that turn as the fixture. If ten attempts produce none, record that in *Resume* and drop the plan.

## Validation

- The fixture has a `message_start`, a `thinking` block, a `message_delta` with `stop_reason: end_turn`, and a `message_stop`, with no `text` or `tool_use` block between them.

## Resume

Implemented 2026-09-26.
- `test/fixtures/claude-empty-round.jsonl` is trimmed from a real capture of `claude -p --output-format stream-json --include-partial-messages --max-thinking-tokens 10000`: a round with a `thinking` block, `stop_reason: end_turn`, and no `text` or `tool_use`.
- The same capture produced `test/fixtures/claude-answered-round.jsonl`, an ordinary round with text, for the other half of the test.
- Found: extended thinking needed `--max-thinking-tokens`; `--thinking adaptive` and `MAX_THINKING_TOKENS` left `thinking_tokens` at zero on this CLI (2.1.267, `claude-opus-5`).
- Found: the empty round carries no thinking text because the CLI hid it, so the fixture proves the round boundary rather than the thinking content.
- The untrimmed capture is `.scratch/claude-round-budget/attempt-2.jsonl`, which is not committed.

