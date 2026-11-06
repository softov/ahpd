---
title: The docs name x-ahpd/me
status: done
depends: [task-02-x-ahpd-me-answers-the-connection.md]
layer: docs
refs:
  - "[code://docs/sdk/USERS.md#L327-L360](../../../../docs/sdk/USERS.md#L327-L360) - the token commands, the section that `x-ahpd/me` goes after"
---

## Objective

The users docs say what `x-ahpd/me` answers, for a person and for root.

## Files

- `UPDATE: docs/sdk/USERS.md:327-360` - add a section after the token commands with the command and its fields.

## Steps

1. Add a section that names `x-ahpd/me`, its empty params and its answer.
2. Add a table with each field of `Me` and one line on it.
3. Say that root gets `*:*` and its own pool, and that a minted token gets its own grants.
4. Keep the file's own line wrap.
5. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `docs/sdk/USERS.md` names every field of `Me` in `packages/sdk/src/types/users.ts`.

## Resume

- **Done so far:** steps 1 to 4. `docs/sdk/USERS.md` has the section "Who a connection is".
- **Next action:** review by Softov.
- **Open questions:** none.
