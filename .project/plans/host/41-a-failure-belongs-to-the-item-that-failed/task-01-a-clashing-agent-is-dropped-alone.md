---
title: A clashing agent is dropped alone
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/plugins.ts#L124-L135](../../../../packages/sdk/src/plugins.ts#L124-L135) - the fold's agent loop"
  - "[code://packages/server/src/commands/run.ts#L622-L623](../../../../packages/server/src/commands/run.ts#L622-L623) - the exit on a clash"
---

## Objective

An agent whose `provider` is already held is not added, with one problem line naming both holders; the rest of that plugin's contribution and the daemon carry on.

## Files

- `UPDATE: packages/sdk/src/plugins.ts:124-135` - a clashing agent is reported and skipped, not pushed onto `added`; the comment on `AGENT_CLASH` says it is a problem line like the others.
- `UPDATE: packages/server/src/commands/run.ts:623` - no exit on `AGENT_CLASH`.
- `UPDATE: packages/sdk/test/` (the fold's test file) - the cases below.

## Steps

1. Skip the clashing agent; keep the problem text as it is.
2. Drop the exit in `run.ts`; a daemon with no agent left still refuses as it does today.

## Validation

- Fold test: plugin A registers `x` and `y`, plugin B registers `y` and `z`; the fold answers `x`, `y` (A's) and `z`, with one problem naming B and `y`.
- A clash with a base agent keeps the base agent.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
