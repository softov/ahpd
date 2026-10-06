---
title: Policies and automations are written owner-only
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/policies.ts#L311-L323](../../../../packages/sdk/src/policies.ts#L311-L323) - `save`, the write with no mode"
  - "[code://packages/sdk/src/scheduled.ts#L197-L207](../../../../packages/sdk/src/scheduled.ts#L197-L207) - the automation file's write, with no mode"
  - "[code://packages/sdk/src/sessions.ts#L236-L241](../../../../packages/sdk/src/sessions.ts#L236-L241) - the write to copy: pid temp name and `{ mode: 0o600 }`"
  - "[code://packages/sdk/test/policies.test.ts](../../../../packages/sdk/test/policies.test.ts) - `filePolicies` cases"
  - "[code://packages/sdk/test/scheduled.test.ts](../../../../packages/sdk/test/scheduled.test.ts) - `scheduledAutomations` cases"
---

## Objective

`filePolicies` and `scheduledAutomations` write their file owner-only, so a policy list or an automation's owner is readable by the daemon's account and nobody else.

## Files

- `UPDATE: packages/sdk/src/policies.ts:318` - `writeFileSync(temporary, ..., { mode: 0o600 })`; today no options.
- `UPDATE: packages/sdk/src/scheduled.ts:202` - the same.
- `UPDATE: packages/sdk/test/policies.test.ts` - one case.
- `UPDATE: packages/sdk/test/scheduled.test.ts` - one case.

## Steps

1. Pass `{ mode: 0o600 }` to both writes, with a one-line comment in each saying who may read the file, in the words `owners.ts` uses.
2. Leave the temp name, the rename and the error wording as they are.

## Validation

- Written first and seen failing (the mode reads `0644` under the default umask): in each test file, a store over a temp directory saves once and `statSync(file).mode & 0o777` is `0o600`.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk/test/policies.test.ts packages/sdk/test/scheduled.test.ts`.

## Resume
