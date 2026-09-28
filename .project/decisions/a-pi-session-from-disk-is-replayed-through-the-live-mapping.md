---
title: A pi session from disk is replayed through the live mapping, and its turns keep their entry ids
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/agent-pi/src/transcript.ts#L1-L14](../../packages/agent-pi/src/transcript.ts#L1-L14) - the stance this replaces: no rebuild, to avoid a second mapping"
  - "[code://packages/agent-pi/src/mapping.ts#L88-L242](../../packages/agent-pi/src/mapping.ts#L88-L242) - `mapEvent`, the one translation from pi's events to AHP actions"
  - "[code://packages/agent-pi/src/session.ts#L170](../../packages/agent-pi/src/session.ts#L170) - `ends`, the leaf each watched turn ended at, which `endPoint` answers from"
  - "[code://packages/agent-claude/src/transcript.ts#L54](../../packages/agent-claude/src/transcript.ts#L54) - the sibling rebuilds turns from its own store"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `SessionManager.findById`, `SessionManager.open` and `getBranch()`, in `dist/core/session-manager.d.ts`
---

## Context

A pi session this process did not watch opens empty, although pi's session file holds the whole conversation.
The transcript comment chose not to rebuild turns from pi's entries, because a second mapping from pi's messages to AHP turns would drift from `mapping.ts`.

## Decision

A session with no watched record is rebuilt from pi's file: the entries on the current branch, read with pi's `SessionManager`, are turned into the events pi raises live and fed through the same `mapEvent`.
Each rebuilt turn keeps the id of the entry it ended at, so `endPoint` answers for it as for a watched turn.

Source: Softov, 2026-09-28, asked whether a rebuild reuses the live mapping or has its own reader: "Replay through mapping.ts"; and whether a rebuilt turn remembers pi's entry ids: "Yes, record them".

## Consequences

There is one translation from pi to AHP, and a rebuilt turn reads the same as a live one.
The replay has to produce events in pi's live order, and a change in pi's stored entry types is met in one place, the replay.
A truncation works on a session opened after a restart.

## Options

- **A second reader**: map stored entries straight to AHP turns in `transcript.ts`; simpler to read, but two translations to keep in step.
- **History only**: rebuild turns without entry ids; truncation stays limited to turns this process watched.
