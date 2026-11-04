---
title: A folder is walked once
status: implemented
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/disk.ts#L202-L214](../../../../packages/agent-claude/src/session/disk.ts#L202-L214) - `markdownUnder`"
---

## Objective

`markdownUnder` walks each real folder once, so a link back up ends the walk there.

## Files

- `UPDATE: packages/agent-claude/src/session/disk.ts:202-214` - `markdownUnder` takes a `seen` set of real paths, adds the folder's real path, and returns at once for a path in the set.
- `UPDATE: packages/agent-claude/test/disk.test.ts` - a case with two links to `.` in a rules folder, and a case with a linked folder that holds a rule.

## Steps

1. Get the folder's real path with `realpathSync`.
2. Return `found` when `realpathSync` throws or `seen` has the path.
3. Add the real path to `seen`, then read the folder's names.
4. Pass `seen` to each call under the folder.
5. Add a loop case with a timeout of 5 seconds: the walk gives the rule beside the links once.
6. Add a case for a linked folder: the walk gives the rule in it.

## Validation

- The loop case fails without the change and passes with it.
- `pnpm --filter @ahpd/agent-claude test` passes, run alone.

## Resume

- **Done so far:** every step.
- **Found:** without the change the loop case does not hang. The walk finds the rule again through each link until `RULE_MOST` stops it, and the case fails on the duplicates.
