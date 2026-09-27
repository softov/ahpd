---
title: The agent's plan is shown
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L188-L196](../../../../packages/agent-acp/src/mapping.ts#L188-L196) - dropped updates"
---

## Objective

A `plan` update replaces a markdown part in the turn listing each entry with its status.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts`.

## Steps

1. One part per turn, replaced on each plan update.

## Validation

- Two plan updates leave one part with the second's entries.

## Resume
