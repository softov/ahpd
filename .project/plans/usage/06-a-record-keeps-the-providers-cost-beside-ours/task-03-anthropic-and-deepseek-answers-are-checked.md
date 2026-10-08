---
title: Anthropic-dialect and DeepSeek answers are checked from captured replies
status: todo
depends: [task-02-the-proxy-reads-the-providers-cost.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/dialects.ts#L153-L185](../../../../packages/server/src/proxy/dialects.ts#L153-L185) - the token readers for both dialects"
  - https://api-docs.deepseek.com/api/create-chat-completion - DeepSeek's `usage`, with `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`
  - https://docs.anthropic.com/en/api/messages-streaming - Anthropic's `message_start` and `message_delta` usage
---

## Objective

The proxy reads the tokens and the cost of three answers: Anthropic, OpenRouter in the Anthropic dialect, and DeepSeek.
A test holds each reply, whole and streamed.

## Files

- `CREATE: packages/server/test/fixtures/proxy-usage/` - one captured reply per case, with keys and ids removed.
- `UPDATE: packages/server/src/proxy/dialects.ts:157-165` - `openaiUsage` reads `prompt_cache_hit_tokens` as the cache read when `prompt_tokens_details.cached_tokens` is absent, if the capture shows DeepSeek needs it.
- `UPDATE: packages/server/test/` - one test per fixture.

## Steps

1. Capture each reply, whole and streamed.
   Use the `anthropic` provider, OpenRouter in the Anthropic dialect, and a `deepseek` provider in the configuration.
   Softov runs the captures that need his keys.
2. Write a test per reply: the tokens, the cache read and write, and the cost the record gets.
3. Fix what a test shows the proxy reads wrong.

## Validation

- A test per fixture: the record's tokens match the reply's, cache counted once.
- A test: a DeepSeek reply with `prompt_cache_hit_tokens` gives a cache read and an input without it.
- A test: an Anthropic streamed reply takes input from `message_start` and output from the last `message_delta`.
- `npx vitest run packages/server` passes.
- By hand: `scripts/completions.mjs --only messages` against an Anthropic model and a DeepSeek model answers 200, and `ahpd usage` shows the records.

## Resume

