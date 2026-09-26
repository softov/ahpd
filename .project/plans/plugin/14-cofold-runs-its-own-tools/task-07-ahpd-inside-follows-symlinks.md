---
title: ahpd's workspace check follows symlinks
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L43-L46](../../../../packages/agent-cofold/src/session.ts#L43-L46) - `insideDirectory`, a string comparison of `path.resolve` results"
  - "[code://packages/agent-cofold/src/session.ts#L440-L445](../../../../packages/agent-cofold/src/session.ts#L440-L445) - the policy that hands it to `policyOf` as `inside`"
  - "[code://test/agent-cofold-tools.test.ts#L328-L354](../../../../test/agent-cofold-tools.test.ts#L328-L354) - `ROWS`, the mode table"
---

## Objective

`insideDirectory` judges a path by its real location, so `acceptEdits` asks before a write that a symlink inside the workspace sends outside it, per [decision: the boundary follows symlinks](../../../decisions/the-workspace-boundary-follows-symlinks.md).

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:43-46` - `insideDirectory` compares real paths.
- `UPDATE: test/agent-cofold-tools.test.ts:328-354` - a row for the symlink case.

## Steps

1. In `insideDirectory`, take `realpathSync.native` of the workspace, and of the target's nearest existing ancestor with the part that does not exist yet appended; compare those.
2. A workspace that does not exist falls back to the lexical comparison, so a check never throws.
3. Keep the doc comment on `insideDirectory` a statement of what it decides.

## Validation

- `test/agent-cofold-tools.test.ts`: a row "an edit through a symlink out of the workspace" (`write_file` to `link/x.txt`, with `link` a symlink to the `away` folder) expects `acceptEdits: 'ask'`, `bypassPermissions: 'run'`, `plan: 'deny'`, `dontAsk: 'deny'`, `default: 'ask'`, `auto: 'ask'`; under `acceptEdits` it runs today and writes `away/x.txt`, so the row fails before the fix.
- `node_modules/.bin/vitest run test/agent-cofold-tools.test.ts` green.

## Resume
