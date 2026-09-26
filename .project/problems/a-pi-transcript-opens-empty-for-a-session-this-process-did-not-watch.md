---
title: A pi transcript opens empty for a session this process did not watch
status: open
date: 2026-09-26
severity: major
blocks: []
refs:
  - "[code://packages/agent-pi/src/catalog.ts#L20](../../packages/agent-pi/src/catalog.ts#L20) - the record of watched sessions, in memory only"
  - "[code://packages/agent-pi/src/transcript.ts#L1-L14](../../packages/agent-pi/src/transcript.ts#L1-L14) - why pi's own entries are not read back"
  - "[code://packages/agent-pi/src/transcript.ts#L30-L49](../../packages/agent-pi/src/transcript.ts#L30-L49) - `turnsOf`, which reads only the watched record"
  - "[code://packages/agent-pi/src/agent.ts#L103-L106](../../packages/agent-pi/src/agent.ts#L103-L106) - `transcript` answers `undefined` for anything not watched"
  - "[code://packages/agent-pi/src/catalog.ts#L67-L102](../../packages/agent-pi/src/catalog.ts#L67-L102) - the listing already reads pi's files"
  - "[code://packages/agent-pi/README.md#L62-L64](../../packages/agent-pi/README.md#L62-L64) - the README states the gap"
  - "[code://packages/agent-claude/src/transcript.ts](../../packages/agent-claude/src/transcript.ts) - the sibling rebuilds turns from the CLI's own transcript file"
  - "[code://.project/decisions/a-failed-transcript-read-is-not-an-empty-session.md](../decisions/a-failed-transcript-read-is-not-an-empty-session.md) - what the host does with an `undefined` transcript"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `SessionManager.open(path)` and `getBranch()` in `dist/core/session-manager.d.ts`
---

## Symptom

Open a pi session that this daemon did not run since it started: a row listed from pi's files, a session made with the `pi` command, or any session after `ahpd` restarts.
The chat opens with no turns, although pi's session file holds the whole conversation and the model still sees it on the next turn.

## Cause

The transcript is the in-memory record of turns this process watched run.
The file comment in `transcript.ts` chose not to rebuild turns from pi's entries, because that is a second mapping from pi's messages to AHP turns to keep in step with `mapping.ts`.

## Impact

Every client, after every daemon restart, sees an empty history for a conversation that is not empty.
A truncation is also impossible on such a session, because `endPoint` only knows watched turns.

## Workaround

None.

## Fix

Candidate, from Softov's brief of 2026-09-26: rebuild the turns from pi's JSONL with `SessionManager.open(file).getBranch()`, found through `stateFile`, for a session with no watched record.
Open before it is a task: whether the rebuild shares `mapping.ts` (replaying stored messages through the same translation) or is a second reader beside it, which is the cost the `transcript.ts` comment names; and whether a rebuilt turn records its entry ids so `endPoint` and `forkPoint` answer for it too, which the `Session` contract says they need not.
