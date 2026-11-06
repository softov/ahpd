---
title: A failed open says why - implemented
date: 2026-11-05
refs:
  - git://01613c50 - the merge of #238
  - "[code://packages/sdk/src/agents/channel.ts](../../../../packages/sdk/src/agents/channel.ts) - the reason an agent did not open, on its row"
---

An agent or a connector that does not open at start says why on its row, so a person sees the reason without the log.

## What was built

- [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts) - an agent's failed open on its row.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - a connector's failed open on its row.

## Verified

- The new cases in `agents-channel.test.ts` and `connectors-channel.test.ts` fail without the change.
- CI on main after #242 passed every check.

## Departures from the plan

- A connector's put also calls `openOne`, so a failed put leaves its reason on the row too.

## Left for later

- none
