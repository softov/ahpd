---
title: A session this process never watched is loaded when a client reads it, not when its next turn starts
status: done
depends: [task-02-collected-replay-becomes-turns.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/transcript.ts#L1-L13](../../../../packages/agent-acp/src/transcript.ts#L1-L13) - a session this process never watched answers `undefined`"
  - "[code://packages/agent-acp/src/session.ts#L517-L600](../../../../packages/agent-acp/src/session.ts#L517-L600) - `open`: `session/load` runs only on a turn's `open()`"
---

## Objective

When `Agent.transcript` is asked for a session this process never watched and the server advertises `loadSession`, the bridge opens the server, runs `session/load`, and answers the turns task 02 builds from the replay.
A read loads the session and lets the server go; the turn after it loads it again, as [a read's connection carries none of a session's ports](../../../decisions/an-acp-read-and-the-turn-after-it-load-twice.md), and the replay the second load sends is not added to a record that already holds turns.
A server without `loadSession` answers `undefined`, as now.

## Steps

1. Failing first, with the scripted ACP server: after a fresh process, `transcript` for a known session id answers its replayed turns; a following turn loads again, and the history still reads as one conversation rather than two.
2. A server without `loadSession`: `transcript` answers `undefined` and spawns nothing.
3. The load asks for the folder the server last reported for that session, since a server that keeps a conversation by its folder finds nothing when asked with the daemon's.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
