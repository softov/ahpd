---
title: claude counts every call, subagents and cache writes included, with its cost - implemented
date: 2026-10-01
refs:
  - git://usage-p1-claude - the branch it was built on
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
---

A claude turn now reports its usage as the sum of every API call it made, subagent calls included, with cache writes, sent as a running total after each call, and the turn's cost from `modelUsage` at the end.

## What was built

- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - the per-turn sum, input from `message_start`, output from `message_delta`, a running `chat/usage` per call, and `costOf`, the change in `modelUsage` since the last `result`.
- [`code://packages/agent-claude/test/agent-claude-usage.test.ts`](../../../../packages/agent-claude/test/agent-claude-usage.test.ts) - six cases over captured stream fixtures.

## Verified

- `pnpm -F @ahpd/agent-claude test`: 10 files, 69 tests passed, 6 of them new; the two review fixes each fail their test when removed.
- `pnpm typecheck` clean.

## Departures from the plan

- Input counts are taken from `message_start` and output from `message_delta` only: `message_delta` repeats the input counts, so reading both whole would bill every prompt twice.
- Review fix: a turn whose stream carried no partial messages falls back to `result.usage`.
- Review fix: only a model whose cost changed in this result can make the total a guess, because `modelUsage` is cumulative per query.

## Left for later

- Restored turns keep the usage their transcripts give, as the parent plan says.
