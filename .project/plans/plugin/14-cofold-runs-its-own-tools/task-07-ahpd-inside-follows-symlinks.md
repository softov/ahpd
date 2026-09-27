---
title: ahpd's workspace check follows symlinks
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L50-L51](../../../../packages/agent-cofold/src/session.ts#L50-L51) - `insideDirectory`, which judges a path by where it really is"
  - "[code://packages/agent-cofold/src/session.ts#L444-L449](../../../../packages/agent-cofold/src/session.ts#L444-L449) - the policy that hands it to `policyOf` as `inside`"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L547-L597](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L547-L597) - `ROWS`, the mode table"
---

## Objective

`insideDirectory` judges a path by its real location, so `acceptEdits` asks before a write that a symlink inside the workspace sends outside it.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:50-51` - `insideDirectory` judges real paths.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:571-578` - a row for the symlink case.

## Steps

1. In `insideDirectory`, take `realpathSync.native` of the workspace, and of the target's nearest existing ancestor with the part that does not exist yet appended; compare those.
2. A workspace that does not exist falls back to the lexical comparison, so a check never throws.
3. Keep the doc comment on `insideDirectory` a statement of what it decides.

## Validation

- `packages/agent-cofold/test/agent-cofold-tools.test.ts`: a row "an edit through a symlink out of the workspace" (`write_file` to `link/x.txt`, with `link` a symlink to the `away` folder) expects `acceptEdits: 'ask'`, `bypassPermissions: 'run'`, `plan: 'deny'`, `dontAsk: 'deny'`, `default: 'ask'`, `auto: 'ask'`; under `acceptEdits` it runs today and writes `away/x.txt`, so the row fails before the fix.
- `node_modules/.bin/vitest run packages/agent-cofold/test/agent-cofold-tools.test.ts` green.

## Resume

Verified 2026-09-26: the second review reverted this task's fix and the test named in the Validation failed, then passed with the fix back.
The row "an edit through a symlink out of the workspace" is in `ROWS` and passes under every mode.
