---
title: The host describes every agent - implemented
date: 2026-10-27
refs:
  - git://288ddab7
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts)"
---

Every agent on the root channel carries the `description` that `AgentInfo` requires: the backend's own, or its display name.

## What was built

- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `descriptors` sends a description for every agent.

## Verified

- The ACP and cofold cases of p3 and p4 report no missing `description` after this change, and report it before.
- `pnpm typecheck` passes.

## Departures from the plan

- none.

## Left for later

- none.
