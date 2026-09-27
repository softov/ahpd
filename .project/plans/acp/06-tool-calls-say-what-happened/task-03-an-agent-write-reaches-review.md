---
title: An agent's write reaches review
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L311-L316](../../../../packages/agent-acp/src/session.ts#L311-L316) - `writeTextFile`"
  - "[code://packages/sdk/src/types/agent.ts#L203](../../../../packages/sdk/src/types/agent.ts#L203) - `onFileEdit`"
---

## Objective

`fs/write_text_file` calls `start.onFileEdit(turnId, path, "before")` and `"after"` around the write.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:311-316`.

## Steps

1. Outside a turn there is no turn id; the write goes through as today.

## Validation

- A fixture write inside a turn appears in the host's changeset.

## Resume
