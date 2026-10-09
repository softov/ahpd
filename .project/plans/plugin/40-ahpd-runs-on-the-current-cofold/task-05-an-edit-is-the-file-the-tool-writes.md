---
title: An edit is the file the tool says it writes
status: todo
depends: [task-01-ahpd-takes-the-cofold-release.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/turnagent.ts#L30-L48](../../../../packages/agent-cofold/src/turnagent.ts#L30-L48) - `EDITS` and `editPathOf`"
  - "[code://packages/agent-cofold/src/turnagent.ts#L146-L162](../../../../packages/agent-cofold/src/turnagent.ts#L146-L162) - `announceEdit` and `settleEdit`"
  - "[code://packages/agent-cofold/src/turnagent.ts#L324-L342](../../../../packages/agent-cofold/src/turnagent.ts#L324-L342) - the edit hooks and the policy with `isEdit`"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L262-L271](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L262-L271) - the mode table's rows"
  - file:///github/cofold/.project/plans/tools/02-tools-declare-what-they-touch/deferred.md - the ahpd row this task closes
---

## Objective

The changeset hears of an edit to the file `tool.writes(input)` names, when that file is inside the workspace.
ahpd keeps `isEdit` from `effects.writes`, so a host tool still counts as an edit by what it declares.

## Files

- `UPDATE: packages/agent-cofold/src/turnagent.ts:30-48` - `EDITS` goes; `editPathOf(tool, input)` returns `tool.writes?.(input)` when it is inside the workspace, else `undefined`.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:146-162` - `announceEdit` and `settleEdit` look up the tool to call `editPathOf`.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:324-342` - the hooks pass the tool; the policy's `isEdit` stays.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:262-271` - a row for `memory_write` under `acceptEdits`, which asks.

## Steps

1. Read how the `beforeTool` and `afterTool` hooks receive the tool in cofold agents 0.2.1.
2. Delete `EDITS`.
3. Make `editPathOf` call `tool.writes`, and keep the path only when `insideDirectory` says it is inside.
4. Pass the tool from the hooks into `announceEdit` and `settleEdit`.
5. Add a mode-table row: `memory_write` under `acceptEdits` asks, because its file is outside the workspace.
6. Add a case: a `memory_write` sends no `onFileEdit`.
7. Add a case: the edit's `before` reaches the client before the row's start.

## Validation

- `rg "EDITS" packages/agent-cofold/src` finds nothing.
- `npx vitest run packages/agent-cofold/test/agent-cofold-tools.test.ts` passes.

## Resume

- Before 0.2, cofold's `acceptEdits` judged `memory_write`'s relative path against the workspace and allowed it; the new row records the fix.
