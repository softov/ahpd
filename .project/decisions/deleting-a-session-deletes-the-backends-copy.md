---
title: Deleting a session deletes the backend's own copy of it
status: accepted
date: 2026-10-04
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L95-L98](../../packages/sdk/src/host/lifecycle.ts#L95-L98) - `removeSession`, which tears down only what the daemon holds"
  - "[code://packages/agent-claude/src/catalog.ts#L20](../../packages/agent-claude/src/catalog.ts#L20) - the Claude catalogue, read from the transcripts on disk"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `deleteSession(sessionId, { dir })` removes a session's transcript
---

## Context

A backend's catalogue is read from its own store: Claude's transcripts, pi's session files, cofold's store, an ACP server's `session/list`.
`disposeSession` removed what the daemon held and left that store alone, so the next listing offered the session again, under whichever agent read it first, and a row only listed could not be deleted at all.

## Decision

Deleting a session asks the agent that owns it to delete its own copy, for a session the daemon is running and for a row it only lists.

Softov, 2026-10-04, asked "How should deleting a session work?": "Backend deletes, listed too".

## Consequences

A deleted session is gone from every client and from the backend's own tools: Claude Code's `/resume` no longer offers it.
Every agent with a `list` needs a `delete`, or its deleted rows return; one whose store cannot delete says so.
A delete cannot be undone from the host.

## Options

- The host records deleted ids and filters them out of every listing, leaving the store untouched. Lost: transcripts pile up on disk, and the backend's own tools still offer the session.
- Only agent-claude deletes, and only a running session. Lost: a listed row stays undeletable, and pi, cofold and ACP keep the same gap.
