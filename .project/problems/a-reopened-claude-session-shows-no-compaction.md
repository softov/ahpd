---
title: A reopened Claude session shows no sign of a compaction it showed live
status: open
date: 2026-10-06
severity: minor
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L322](../../packages/agent-claude/src/transcript.ts#L322) - a frame with `isCompactSummary` is skipped"
  - "[code://packages/agent-claude/src/session/query.ts#L345-L358](../../packages/agent-claude/src/session/query.ts#L345-L358) - live, `compact_boundary` becomes a `systemNotification`"
---

## Symptom

A Claude session that compacted shows `Context compacted automatically: ...` while it runs, and after a reconnect or a daemon restart the same turn has no notice and no summary.

## Cause

The transcript reader skips the summary frame (`transcript.ts:322`) and has no case for the `compact_boundary` system frame the live path reads; whether that frame is in the session file at all is unknown.

## Impact

The live and reopened views of one session differ, and a reopened session does not say that the model stopped seeing its earlier turns.

## Workaround

none

## Fix

Candidates, none chosen: rebuild the live notice from the boundary frame if the file keeps it; or show the summary frame as a `systemNotification`.
