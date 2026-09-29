---
title: A session this process never watched is loaded when a client reads it, not when its next turn starts
status: todo
depends: [task-02-collected-replay-becomes-turns.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/transcript.ts#L1-L13](../../../../packages/agent-acp/src/transcript.ts#L1-L13) - a session this process never watched answers `undefined`"
  - "[code://packages/agent-acp/src/session.ts#L517-L600](../../../../packages/agent-acp/src/session.ts#L517-L600) - `open`: `session/load` runs only on a turn's `open()`"
---

## Objective

When `Agent.transcript` is asked for a session this process never watched and the server advertises `loadSession`, the bridge opens the server, runs `session/load`, and answers the turns task 02 builds from the replay; the same open serves the session's next turn rather than loading it twice.
A server without `loadSession` answers `undefined`, as now.

## Steps

1. Failing first, with the scripted ACP server: after a fresh process, `transcript` for a known session id answers its replayed turns; a following turn sends one `session/load` in all, not two.
2. A server without `loadSession`: `transcript` answers `undefined` and spawns nothing.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
