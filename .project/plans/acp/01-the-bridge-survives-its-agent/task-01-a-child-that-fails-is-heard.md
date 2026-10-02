---
title: A child that fails to start or exits is heard
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L55-L64](../../../../packages/agent-acp/src/connection.ts#L55-L64) - the spawn"
  - "[code://packages/agent-acp/src/catalog.ts#L116-L139](../../../../packages/agent-acp/src/catalog.ts#L116-L139) - the listing spawn"
---

## Objective

`connectAcp` listens for `error` and `exit` on the child, a start that fails rejects with a sentence naming the command, and every pending request rejects with the exit code; nothing reaches the process as an unhandled error.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts:55-64` - listeners, and a promise that settles when the child is gone.
- `UPDATE: packages/agent-acp/src/catalog.ts:116-139` - the listing survives a missing command and answers the watched sessions.
- `UPDATE: packages/agent-acp/test/` - a spec with a command that does not exist; a fixture that exits mid-prompt.

## Steps

1. Race `initialize` against the child's `error` and `exit`.
2. Reject open requests with `<command> exited with <code>` when the child goes.
3. Mark the connection dead so the session knows to reopen.

## Validation

- A missing command fails `create`'s first turn with the command in the sentence, and the test process is still alive.
- `list` with a missing command answers the watched sessions.
- A fixture that exits mid-prompt fails the turn with its exit code.
