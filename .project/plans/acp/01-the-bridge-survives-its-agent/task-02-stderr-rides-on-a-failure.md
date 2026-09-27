---
title: The last of stderr rides on a failure
status: todo
depends: [task-01-a-child-that-fails-is-heard.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L60-L62](../../../../packages/agent-acp/src/connection.ts#L60-L62) - stderr drained"
  - "[code://packages/agent-acp/src/session.ts#L634-L650](../../../../packages/agent-acp/src/session.ts#L634-L650) - how a failed turn ends"
---

## Objective

The last 8 KB of the child's stderr is kept, and a failed open or turn carries it in its `chat/error` message and in the daemon log.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts` - a ring of the last 8 KB.
- `UPDATE: packages/agent-acp/src/session.ts:634-650` - the tail appended to the failure.

## Steps

1. Keep bytes, cut on a line boundary when showing them.
2. Only a failure shows the tail; a healthy server's chatter is never surfaced.

## Validation

- A fixture that writes to stderr and exits fails the turn with those lines in the message.

## Resume
