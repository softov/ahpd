---
title: The agent's title is the session's
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L861-L866](../../../../packages/agent-acp/src/session.ts#L861-L866) - the derived title"
---

## Objective

`session_info_update.title` emits `session/titleChanged` and updates the catalogue, unless a person renamed the session.

## Files

- `UPDATE: packages/agent-acp/src/session.ts`.

## Steps

1. Track whether the title came from a person.

## Validation

- A fixture title replaces the derived one; a renamed session keeps its name.

## Resume
