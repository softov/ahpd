---
title: Only a machine ahpd made is judged as made under bind
status: done
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

- **Implemented** 2026-10-07 on `build/agents/4f2c8f8e`.
- `packages/computer/src/runtime.ts`: `MADE_LABELS` holds the six labels a machine of ahpd's carries (`ahpd.agents`, `ahpd.disposable`, `ahpd.profile`, `ahpd.owner`, `ahpd.session`, `ahpd.host`). `madeUnderBind` answers false for a record carrying none of them, before it reads `ahpd.git` or a mount. A container made elsewhere is never judged, whatever its definition binds.
- `computer-disposable.test.ts`: the two cases below. The `bound` machine of `leaves a labelled fetch machine and an open machine of the old guard alone` and the `under-bind` machine of `tells a session the sentence when it asks for such a machine` gained `ahpd.session`. That label is what a daemon before this one wrote for a machine it made for a session. A container carrying the provider's label alone is now the dev container this task leaves where it is.
