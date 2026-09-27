---
title: Close ends the session and every process it started
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L159-L164](../../../../packages/agent-acp/src/connection.ts#L159-L164) - close"
  - "[code://packages/agent-acp/src/session.ts#L1151-L1173](../../../../packages/agent-acp/src/session.ts#L1151-L1173) - the session's close"
---

## Objective

Closing sends `session/close` when the server advertises it, ends stdin, sends SIGTERM to the process group, and SIGKILL after five seconds.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts` - spawn `detached` so the child leads a group; the kill sequence.
- `UPDATE: packages/agent-acp/src/session.ts:1151-1173` - `session/close` first.

## Steps

1. Spawn with `detached: true` and kill `-pid`.
2. In a computer the child is `docker exec`; its group is the exec client, and the machine's own processes are the machine's to end.

## Validation

- A fixture that starts a grandchild leaves no process after close.
- A fixture advertising close receives `session/close`.

## Resume
