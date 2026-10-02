---
title: Replay lands in the session's history, never in its next turn - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-acp/src/transcript.ts](../../../../packages/agent-acp/src/transcript.ts)"
  - "[code://packages/agent-acp/src/catalog.ts](../../../../packages/agent-acp/src/catalog.ts)"
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts)"
---

What an ACP server replays on `session/load` becomes the session's earlier turns rather than part of the next answer, and a session this process never watched shows its history when a client reads it after a restart.

## What was built

- [`code://packages/agent-acp/src/transcript.ts`](../../../../packages/agent-acp/src/transcript.ts) - `replayedTurns`: a turn starts at a user message, and consecutive user chunks are one message.
- [`code://packages/agent-acp/src/catalog.ts`](../../../../packages/agent-acp/src/catalog.ts) - `loadedSession`: a read spawns, loads in the directory the server listed the session under, collects the replay and lets the server go; a record that already holds turns is not given the replay again.
- [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) - replay collected apart from any turn while a session opens, and emptied once kept.
- `packages/agent-acp/README.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 161 files and 2384 tests, `pnpm boundary` clean.
- A load's replay stays out of the turn that asked for it and the one after; a loaded session reads back with its replayed turns ahead of the new one; a read followed by a turn does not replay twice; a read leaves no server running.
- A probe of a user message sent in two chunks gives one turn.

## Departures from the plan

- [A read and the turn after it each load the session](../../../decisions/an-acp-read-and-the-turn-after-it-load-twice.md), decided during the build: a read's connection has no session ports for a turn to reuse.
- A read puts its row in the process's watched registry, so the turn that follows finds it.

## Left for later

- none.
