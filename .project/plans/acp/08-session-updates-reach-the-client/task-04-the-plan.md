---
title: The agent's plan is shown
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L188-L196](../../../../packages/agent-acp/src/mapping.ts#L188-L196) - dropped updates"
---

## Objective

A `plan` update is the turn's one tool call for the plan: each entry a line of its content, replaced by the next plan, and completed when the turn ends.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts`.

## Steps

1. One call per turn, opened and readied by the first plan, its content replaced by each one after it, completed with the last plan when the turn ends.

## Validation

- Two plan updates leave one call holding the second's entries.

## Resume
