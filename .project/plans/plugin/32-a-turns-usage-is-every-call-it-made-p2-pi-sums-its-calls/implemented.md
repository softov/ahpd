---
title: pi sums every call of a turn, with its cost - implemented
date: 2026-10-01
refs:
  - git://usage-p2-pi - the branch it was built on
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
---

A pi turn now reports its usage as the sum of every assistant message, sent after each `message_end`, with the summed `usage.cost.total` as its cost.

## What was built

- [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts) - `addUsage`, one message added to the turn's sum with cache writes and cost.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - the turn's `spent`, a running `chat/usage` per call, and the final total at `agent_settled`.
- [`code://packages/agent-pi/test/agent-pi-usage.test.ts`](../../../../packages/agent-pi/test/agent-pi-usage.test.ts) - four cases.

## Verified

- `pnpm -F @ahpd/agent-pi test`: 5 files, 138 tests passed, 4 of them new.
- `pnpm typecheck` clean.

## Departures from the plan

- The final total at `agent_settled` repeats the last per-call total; harmless, since the reducer replaces the turn's usage.
- A retried call that spent tokens before failing now counts toward the turn.

## Left for later

- Restored turns keep the usage their transcripts give, as the parent plan says.
