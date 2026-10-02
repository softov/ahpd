---
title: The agent meter writes one record per turn, or one per report when configured
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts](../../packages/sdk/src/host.ts) - the dispatch loop that sees every `chat/usage`"
  - "[code://packages/agent-claude/src/session.ts#L1317-L1320](../../packages/agent-claude/src/session.ts#L1317-L1320) - a harness reporting the turn's running sum"
---

## Context

Every harness reports a turn's usage as a running sum: each `chat/usage` repeats and grows what the turn has used so far, and the last one before the turn ends is the turn's total.
The policy rules debit usage as it arrives, so a limit can cancel a turn part-way, but most hosts only want to know what each turn cost.

## Decision

The meter writes one record per turn by default: the turn's last report, written when the turn completes, is cancelled or fails.
A daemon configured for it writes one record per report instead, each holding what the report added since the turn's previous one, so a pool's stored total moves during a turn.
Source: Softov, 2026-10-02, asked "Harnesses report a turn's usage as a running sum that grows during the turn. How often should the agent meter write a record?": "configurable... one per turn. on per interaction/report?"

## Consequences

The default store holds one model record per turn, which is what a listing reads as "this turn cost this".
Per-report records sum to the same turn total, so totals and listings agree whichever mode wrote them; a listing of turns has to group per-report records by `turn`.

## Options

- **One per turn only**: rejected, a shared store would not show a long turn's spend until it ended.
- **One per report only**: rejected as the default, it writes many small records for every turn on hosts that never limit anything.
