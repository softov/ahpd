---
title: Collected replay becomes the session's earlier turns
status: done
depends: [task-01-replay-is-collected-not-mapped-into-a-turn.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/transcript.ts#L38-L65](../../../../packages/agent-acp/src/transcript.ts#L38-L65) - watched turns"
  - "[code://packages/agent-acp/src/catalog.ts#L31-L100](../../../../packages/agent-acp/src/catalog.ts#L31-L100) - the catalogue"
---

## Objective

The replay list is split at each user message into watched turns ahead of the new ones, so `Agent.transcript` answers a loaded session's whole history.

## Files

- `UPDATE: packages/agent-acp/src/transcript.ts`.
- `UPDATE: packages/agent-acp/src/catalog.ts`.

## Steps

1. Each replayed turn is its user text plus the updates that follow it, mapped by the same `mapUpdate`.

## Validation

- A loaded session's transcript has the replayed turns, then the new one.
