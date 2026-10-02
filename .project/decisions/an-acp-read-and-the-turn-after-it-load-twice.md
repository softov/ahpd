---
title: An ACP read and the turn after it each load the session, rather than sharing one load
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/agent-acp/src/catalog.ts](../../packages/agent-acp/src/catalog.ts) - `loadedSession`, the read that spawns, loads and exits"
  - "[code://packages/agent-acp/src/connection.ts](../../packages/agent-acp/src/connection.ts) - client capabilities fixed by the handlers given at spawn"
---

## Context

After a restart, a session the bridge never watched is loaded when a client reads it, so its history shows.
A connection's capabilities are fixed by the handlers it is spawned with, and a read has no session to give it file, terminal or permission handlers.
A turn that reused the read's connection would run with no file or terminal ports and every permission refused.

## Decision

A read spawns its own server, sends `session/load`, collects the replay and lets the server go; the turn that follows spawns a server with the session's ports and loads again.
The replay the second load sends is not added to a record that already holds turns.
Source: Softov, 2026-10-02, asked whether a read and the next turn should share one load: "Two loads".

## Consequences

The first turn after a restart costs a second `session/load`.
A read never leaves a server with file or terminal access running.

## Options

- The read spawns a server with the session's full ports and the turn reuses it: one load, but a read has no `Start` to build those ports from, and leaves a live server behind.
- A read answers from what the host stored and only a turn loads: one load, but a session read after a restart shows no history until a turn is sent.
