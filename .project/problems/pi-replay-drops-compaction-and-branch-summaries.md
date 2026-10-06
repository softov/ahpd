---
title: A replayed pi session drops its compaction and branch summaries
status: open
date: 2026-10-06
severity: minor
refs:
  - "[code://packages/agent-pi/src/replay.ts#L118-L124](../../packages/agent-pi/src/replay.ts#L118-L124) - `replayEntries` reads `model_change` and `message` entries and skips every other type"
---

## Symptom

A pi session that was compacted, or that carries a branch summary, reopens with no sign of either: the turns read as if nothing happened between them.

## Cause

`replayEntries` keeps `model_change` and `message` entries only (`replay.ts:123`, `if (entry.type !== 'message') continue;`), so pi's `compaction` and `branch_summary` entries never reach a turn.

## Impact

A person reopening a long pi session cannot tell that the model no longer sees the earlier part, nor read what it was told instead.

## Workaround

none

## Fix

Candidates, none chosen: show one compaction notice in the turn it falls in and keep every message, as decision [a-compacted-session-keeps-its-history-and-shows-a-notice](../decisions/a-compacted-session-keeps-its-history-and-shows-a-notice.md) settles for cofold; or show the summary text itself.
