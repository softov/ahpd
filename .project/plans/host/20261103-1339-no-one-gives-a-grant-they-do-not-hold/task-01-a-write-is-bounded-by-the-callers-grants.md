---
title: A write is bounded by the caller's grants
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/resources/records.ts#L48-L70](../../../../packages/sdk/src/resources/records.ts#L48-L70) - `Records`, which gets an optional `bound`"
  - "[code://packages/sdk/src/resources/records.ts#L165-L192](../../../../packages/sdk/src/resources/records.ts#L165-L192) - `putRecord` and `removeRecord`, which call it"
  - "[code://packages/sdk/src/resources/records.ts#L250-L280](../../../../packages/sdk/src/resources/records.ts#L250-L280) - the resource `write` and `remove`, which pass their `reader`"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L384-L414](../../../../packages/sdk/src/resources/recordschannel.ts#L384-L414) - the `put` and `remove` commands, which pass their `reader`"
  - "[code://packages/sdk/src/access/people.ts#L77-L225](../../../../packages/sdk/src/access/people.ts#L77-L225) - the `user` and `role` records, which write the bound"
  - "[code://packages/server/src/commands/user.ts#L24-L41](../../../../packages/server/src/commands/user.ts#L24-L41) - `bounded`, the rule this copies"
---

## Objective

Every write and removal of a `user` or `role` record over AHP checks that the caller holds every grant it gives or touches.
The command line keeps the same rule today.

## Files

- `UPDATE: packages/sdk/src/resources/records.ts:48-70` - `Records` gets an optional `bound(reader, id, body)`, where `body` is undefined for a removal.
- `UPDATE: packages/sdk/src/resources/records.ts:165-192` - `putRecord` and `removeRecord` take an optional `reader` and await `records.bound` before they write.
- `UPDATE: packages/sdk/src/resources/records.ts:250-280` - the resource `write` and `remove` pass the `reader` they are given.
- `UPDATE: packages/sdk/src/resources/recordschannel.ts:384-414` - the `put` and `remove` handlers pass their `reader`.
- `UPDATE: packages/sdk/src/access/people.ts:77-225` - the `user` and `role` records implement `bound`.
- `CREATE: packages/sdk/test/people-bound.test.ts` - the escalation cases, through both doors.
- `UPDATE: docs/sdk/USERS.md:132-135` - the `role` row says the bound, and the `user` row says it holds over AHP.

## Steps

1. Add `bound?(reader: Principal | undefined, id: string, body: Record<string, unknown> | undefined): Promise<void>` to `Records`, with a comment that says what it refuses.
2. Give `putRecord` and `removeRecord` an optional `reader` parameter, and call `records.bound` before the write and the removal.
3. Pass the `reader` from the resource `write` and `remove` of `recordsProvider` into `putRecord` and `removeRecord`.
4. Pass the `reader` from the `put` and `remove` handlers of `recordsMethods` into `putRecord` and `removeRecord`.
5. Find every other caller of `putRecord` and `removeRecord` with `rg`, and pass a `reader` where one is in scope.
6. In `people.ts`, write a helper that throws `RpcError(-32009, refusalReason(reader.id, grant))` for the first grant `reader.can` refuses.
7. Make the helper return at once when the caller passes no `reader`.
8. On the `role` record, bound the body's `grants` and the role's grants now.
9. For a role removal, bound the role's grants now.
10. On the `user` record, bound `grantsOfRoles` of the body's `roles` and `grantsOfPerson(id)`.
11. For a person removal, bound `grantsOfPerson(id)`.
12. Leave the `team` and `project` records without a `bound`.
13. Write `people-bound.test.ts` with a users file that holds `mo` as `manager` (`user:read`, `user:put`, `role:read`, `role:put`) and `ad` as `admin`.
14. Update the two rows of `docs/sdk/USERS.md`.

## Validation

- `packages/sdk/test/people-bound.test.ts` holds these cases, each through `x-ahpd/roles/put` or `x-ahpd/users/put` and through a resource write on `role://` or `user://`:
  - the host refuses `mo` a role `boss` with `*:*`, and the file has no `boss`;
  - the host refuses `mo` his own role `manager` as `*:*`;
  - the host refuses to let `mo` give himself `admin`;
  - the host refuses to let `mo` edit or remove `ad`;
  - the host refuses to let `mo` remove a role `admin` that the file holds;
  - the host lets `mo` write a role `viewer` with `user:read`, and give it to a new person;
  - `ad` and the root connection write any role and any person.
- `pnpm typecheck` passes.
- `pnpm --filter @ahpd/sdk test` passes, and then `pnpm --filter @ahpd/server test` passes.

## Resume

