---
title: The prose
status: done
depends:
  - task-01-a-socket-on-the-door-token-is-the-host.md
layer: docs
refs:
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the three ways in, whose first row this changes"
  - "[code://.project/working/HANDOFF.md](../../../working/HANDOFF.md) - the state and the constraint about the door"
  - "[code://.project/plans/host/07-identity-and-the-record/deferred.md](../07-identity-and-the-record/deferred.md) - the row that said this waited"
---

## Objective

The pages that describe who may do what say that the deployment's token is the host, and the record that deferred it points here.

## Files

- `UPDATE: docs/USERS.md` - the first row of the three ways in, and a sentence that the door key needs no credential.
- `UPDATE: .project/working/HANDOFF.md` - the state, and the constraint about the door.
- `UPDATE: .project/plans/host/07-identity-and-the-record/deferred.md` - the root row points at this plan.
- `UPDATE: .project/plans/index.md` - the row.

## Steps

1. Correct the table in `docs/USERS.md`: the deployment token's identity is the host itself when a directory is configured.
2. Say in the same page that the door key needs no sign-in, and that a person who should be limited is given their own token.
3. Correct the handoff's line about what the door token confers.
4. Point plan 07's deferred row at this plan and add the index row.

## Validation

- Every claim in the changed pages is checkable against the gate or a test.
- `plans/index.md` has the row with the right status.

## Resume

Done 2026-09-23. `docs/USERS.md` names the door key as the host and says it needs no credential; plan 07's deferred row points here; the index has the row.
