---
title: Anthropic-dialect and DeepSeek answers are checked from captured replies
status: done
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
- `UPDATE: packages/server/src/proxy/dialects.ts:157-165` - only if a test shows the proxy reads a reply wrong; DeepSeek sends `prompt_tokens_details.cached_tokens`.
- `UPDATE: packages/server/test/` - one test per fixture.

## Steps

1. Copy the replies from `~/ahpd-captures/` into the fixtures folder, with ids removed.
2. Use `openrouter-anthropic-*`, `deepseek-anthropic-*` and `deepseek-openai-*`, each as `.json` and `.sse`.
3. Write a test per reply: the tokens, the cache read and write, and the cost the record gets.
4. Fix what a test shows the proxy reads wrong.

## Validation

- A test per fixture: the record's tokens match the reply's, cache counted once.
- A test: the DeepSeek OpenAI reply gives a cache read from `cached_tokens`, and an input without it.
- A test: an Anthropic-dialect streamed reply takes input from `message_start` and output from the last `message_delta`.
- A test: the OpenRouter reply's `cost` becomes the record's provider cost.
- `npx vitest run packages/server` passes.

## Resume

`packages/server/test/fixtures/proxy-usage/` holds twelve files, one captured answer each: OpenRouter in the Anthropic dialect, DeepSeek in the Anthropic dialect, and DeepSeek in the OpenAI dialect, each whole (`.json`) and streamed (`.sse`), two cases per provider and dialect. Each file is the provider's answer as it arrived, with the ids taken out: the `id`, the `system_fingerprint`, and the `signature` of a thinking block. No key and no token is in any of them.

`packages/server/test/proxy-usage-captures.test.ts` holds every fixture: a fake provider replays the file's bytes at the dialect's own path, and the record the proxy writes for the call is asserted against what the answer said. The record's `model` carries `input`, `output` and `cache` with the reply's own figures, the cache counted once, and `cost` and `providerCost` carry what the answer reported. No entry in the test's table has a price, so the charged cost is the provider's figure. Beside the per-fixture cases: the OpenRouter `cost` with its `cost_details` split becomes the record's provider cost, whole and streamed, the stream carrying the figure in its last `message_delta`; DeepSeek's OpenAI reply reads its cache read from `prompt_tokens_details.cached_tokens` and leaves those tokens out of `input`, and the reply whose `cached_tokens` is 0 has no cache at all and its whole prompt as input; an Anthropic-dialect stream takes `input` from `message_start` and `output` from the last `message_delta`, where `message_start` reports `output_tokens` of 0. One case holds that no fixture keeps an id.

`packages/server/src/proxy/dialects.ts` was not changed. Its readers read all twelve answers right, which is what the task's conditional fix was for.

Not covered: Anthropic direct is not among the captures, so only the Anthropic dialect as OpenRouter and DeepSeek speak it is held.

