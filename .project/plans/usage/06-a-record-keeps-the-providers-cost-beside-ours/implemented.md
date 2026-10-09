---
title: A record keeps the provider's cost beside ours - implemented
date: 2026-10-09
refs:
  - git://2b5a656
  - "[code://packages/server/src/proxy/dialects.ts](../../../../packages/server/src/proxy/dialects.ts)"
  - "[code://packages/server/test/proxy-usage-captures.test.ts](../../../../packages/server/test/proxy-usage-captures.test.ts)"
---

A usage record keeps the cost the provider reported beside the cost ahpd charges, and each is split into sent and received.
A missing price or cost stays absent and is never counted as 0.

## What was built

- Tasks 01 and 02, in `2b5a656`: `Cost` carries `input` and `output`, `UsageBase` carries `providerCost`, and a total carries `providerUsd`, `inputUsd` and `outputUsd`.
- [`code://packages/server/test/fixtures/proxy-usage/`](../../../../packages/server/test/fixtures/proxy-usage/) - twelve captured answers from OpenRouter and DeepSeek, whole and streamed, with the ids removed.
- [`code://packages/server/test/proxy-usage-captures.test.ts`](../../../../packages/server/test/proxy-usage-captures.test.ts) - replays each answer through the proxy and asserts the record's tokens, cache and costs.

## Verified

- The gates pass in the review worktree: 261 test files, 4567 tests.
- No fixture holds a key, a token, an auth header or an id.

## Departures from the plan

- None. The readers in `dialects.ts` read all twelve answers right, so task 03 needed no fix.

## Left for later

- Anthropic direct is not among the captures, so only OpenRouter and DeepSeek in the Anthropic dialect are held.
