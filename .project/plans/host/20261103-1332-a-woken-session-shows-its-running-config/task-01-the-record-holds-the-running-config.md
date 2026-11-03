---
title: The record holds the running config
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts) - `recordSeed`"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - the end of `spawn`"
---

## Objective

A state read from the record holds the config a running state holds.
A start of a session's lead under a held state says the backend's customizations where they differ from the state's.

## Files

- `UPDATE: packages/sdk/src/host/snapshots.ts` - `recordSeed` composes the config with a plugin's defaults and this host's own keys.
- `UPDATE: packages/sdk/src/host/spawn.ts` - a start of the lead under a held state compares its customizations.
- `UPDATE: packages/sdk/test/session-wake.test.ts` - a probe that answers late, host options, and the two cases.

## Steps

1. Compose the record's config from the schema, the backend's and a plugin's defaults, and the stored values.
2. Lay this host's own keys on it with `mergedConfig`, where the host decided any.
3. Compare the lead's customizations with a held state's at the end of `spawn`.
4. Say the lead's list by `session/customizationsChanged` where the two differ.
5. Add a case for the config across a wake, and one for a list that moved.

## Validation

- The new cases fail on `c97d8459`'s sources and pass after.
- The touched files' test files pass, one file at a time.
- The wake cases pass on a merge of this branch and the residency branch.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
