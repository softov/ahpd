---
title: The permission modes cover the new tools
status: todo
depends: [task-01-the-four-capabilities.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L353-L365](../../../../packages/agent-cofold/src/session.ts#L353-L365) - the policy: `isEdit` from `effects.writes`, `inside` the workspace"
  - "[code://packages/agent-cofold/src/agent.ts#L105](../../../../packages/agent-cofold/src/agent.ts#L105) - `PERMISSION_MODES`"
---

## Objective

Each permission mode treats the new tools as it says: reads never ask, an edit inside the workspace asks except in `acceptEdits` and above, `shell_exec` asks except in `bypassPermissions`, and `plan` refuses writes.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts` - only if the tests find a mode that does not already hold.

## Steps

1. Write the table as tests first, one row per mode and tool class (read, edit inside, edit outside, shell, web).
2. Fix what fails.

## Validation

- `test/agent-cofold-tools.test.ts` (the mode table), every row asserting ask, allow or refuse.

## Resume
