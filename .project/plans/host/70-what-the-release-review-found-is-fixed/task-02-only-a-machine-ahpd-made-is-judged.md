---
title: Only a machine ahpd made is judged as made under bind
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L1325-L1332](../../../../packages/computer/src/runtime.ts#L1325-L1332) - `madeUnderBind`"
---

## Objective

`madeUnderBind` is false for a machine without the labels ahpd writes.
So the daemon never removes a person's dev container for it.

## Files

- `UPDATE: packages/computer/src/runtime.ts:1325-1332` - the label check.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

## Steps

1. Return false when the machine has none of `ahpd.session`, `ahpd.disposable`, `ahpd.profile`, `ahpd.host`, `ahpd.owner` and `ahpd.agents`.
2. Keep the `ahpd.git` check and the read-only mount check after it.

## Validation

- `it('does not judge an adopted dev container that mounts a .git path read-only')`
- `it('still removes a machine a 0.9 daemon made with the git directory bound')`
- Run the full gates from the plan. All pass.

## Resume

