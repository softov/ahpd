---
title: A client sees who owns a session and who sent each turn - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
---

A client can say whose a session is and which person sent each of its turns, live and after a daemon restart, from `_meta.owner` on the session and `_meta.sender` on each turn.

## What was built

- [`code://packages/sdk/src/types/sessions.ts`](../../../../packages/sdk/src/types/sessions.ts) - `sender(id, turnId)` and `setSender` on `SessionStore`.
- [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts) - the memory and file stores keep senders per session and turn, written as `senders` and read back only as typed references.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `chat/turnStarted` carries `_meta.sender`; `withSender` puts `message._meta.sender` on snapshot turns, the active turn, transcript-read sessions, worker chats and `chat/turnsLoaded` pages; `describes` puts `_meta.owner` on rows and session state; `onTurnRecorded` keeps a sender under a backend's own transcript id.
- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - the optional `Start.onTurnRecorded(turnId, transcriptId)`.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - calls it once per lead turn with the prompt's CLI uuid, never for a worker's echo.
- `docs/AHP.md`, `docs/LIBRARY.md`, `docs/DAEMON.md` - where the sender and owner ride, and that a host with no users directory sends neither.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 148 files and 2156 tests, `pnpm boundary` clean.
- `packages/sdk/test/sessions.test.ts`: senders across a restart, a page of older turns, a backend that names turns `x1`, `x2` finding the sender under both ids, no keys on a host with no users directory.
- `packages/agent-claude/test/agent-claude-turn-recorded.test.ts`: once per turn with the lead prompt's uuid, never for a worker's echo or a frame with no uuid.
- `packages/sdk/test/wire.test.ts` fixture unchanged; a one-off capture through the strict schema showed no undeclared key.

## Departures from the plan

- Claude's transcript names turns by the CLI's uuid, found in review; fixed by decision `a-backend-says-which-transcript-id-a-turn-was-written-as`.
- The task-02 test fixture gave `ana` a membership so `scopeFor` admits her turns.

## Left for later

- The browsed session and worker chat paths of `withSender` are read by hand, not tested: the echo backend has no transcript.
