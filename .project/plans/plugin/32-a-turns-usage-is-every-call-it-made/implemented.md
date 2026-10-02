---
title: A turn's usage is every model call it made, sent as it runs, with the harness's cost - implemented
date: 2026-10-01
refs:
  - git://f6cad5c - the last of the four
---

Every backend now reports a turn's usage as the sum of every model call it made, sent as a running total while the turn runs, with cache writes and the harness's own cost in `usage._meta.cost` when it reports one.

## What was built

- [p1 claude](../32-a-turns-usage-is-every-call-it-made-p1-claude-counts-every-call/implemented.md), [p2 pi](../32-a-turns-usage-is-every-call-it-made-p2-pi-sums-its-calls/implemented.md), [p3 cofold](../32-a-turns-usage-is-every-call-it-made-p3-cofold-counts-each-step/implemented.md), [p4 ACP](../32-a-turns-usage-is-every-call-it-made-p4-acp-reports-what-it-has/implemented.md).

## Verified

- Root `pnpm test` and `pnpm exec tsc --noEmit` passed after each child.

## Departures from the plan

- claude and cofold send counts per call and the cost once at the turn's end; pi sends cost per call; ACP sends cost only, and tokens at the end when its agent reports them.

## Left for later

- Restored turns keep the usage their transcripts give.
