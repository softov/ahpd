---
title: A compacted session keeps its history and shows a notice
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L332-L360](../../packages/agent-claude/src/session/query.ts#L332-L360) - the Claude backend: a live compaction is a notice, and every earlier turn stays"
  - "[code://packages/agent-cofold/src/transcript.ts#L286-L311](../../packages/agent-cofold/src/transcript.ts#L286-L311) - the cofold transcript, which keeps every message and reads the summary"
  - file:///github/cofold/packages/papo/src/turns.ts - papo's `projectTurns`, which hides what a summary covers
---

## Context

When a harness compacts a conversation, the model stops seeing the older messages and sees a summary in their place.
The older messages are still on disk, in cofold's store and in Claude's session file.
papo, cofold's own terminal client, shows the model's view: what a summary covers is not drawn.
ahpd's Claude backend already showed the whole conversation with a notice at the compaction, and the cofold backend had no rule.

## Decision

Once a session compacts, every client still sees the whole conversation, and one notice where the compaction happened says it did.
Only the model's context shrinks; no turn is hidden, live or after the session is reopened, and the summary is never drawn as the model's answer.
The notice reads the same live and in the transcript, worded as the Claude backend words it.
Source: Softov, 2026-10-06, asked "once a cofold session compacts, should its transcript hide the messages the summary covers?": "Keep history, show a notice".

## Consequences

A reopened session reads the same as it did live.
A person scrolling back sees turns the model no longer remembers, and the notice is what tells them where that line is.
ahpd's cofold transcript differs from papo's view of the same store, on purpose.

## Options

- **Hide what the summary covers and show the summary**, as papo's `projectTurns` does.
  Rejected: it removes from every client a history the host can still serve, and the AHP conversation is the person's record, not the model's context.
- **Keep the history and show the whole summary text as a notification.**
  Rejected: the summary is written for the model, can be long, and the Claude backend has no such text to show, so the two backends would read differently.
