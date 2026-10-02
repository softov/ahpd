---
title: The bridge survives its agent - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-acp/src/connection.ts](../../../../packages/agent-acp/src/connection.ts)"
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts)"
---

An ACP server that cannot start, dies, or is closed no longer takes the daemon with it: the failure says why with the server's last stderr, the next turn reopens the same ACP session, and a close leaves no process behind.

## What was built

- [`code://packages/agent-acp/src/connection.ts`](../../../../packages/agent-acp/src/connection.ts) - a child that fails to spawn is heard as a sentence; the last 8 KB of stderr, cut at a line, rides on a failure; the server runs in its own process group, and a close sends SIGTERM to the group and SIGKILL after five seconds; `closeSession`.
- [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) - a turn after a death reopens the same ACP session through `session/load`; a close tells a server that advertised `session/close` before ending it.
- `packages/agent-acp/README.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 161 files and 2384 tests after the rebase onto main, `pnpm boundary` clean; `agent-acp` 83 tests.
- A missing command fails the turn and nothing escapes; a dying server's stderr is in the failure and a healthy one's is not; the turn after a death continues the same session, and fails clearly when the server cannot load; a closed session leaves no process.

## Departures from the plan

- none.

## Left for later

- none.
