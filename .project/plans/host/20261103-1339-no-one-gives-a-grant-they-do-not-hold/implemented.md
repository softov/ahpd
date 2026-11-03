---
title: No one gives a grant they do not hold - implemented
date: 2026-11-03
refs:
  - git://934e06f8
  - "[code://packages/sdk/src/access/people.ts](../../../../packages/sdk/src/access/people.ts)"
  - "[code://packages/sdk/src/resources/records.ts](../../../../packages/sdk/src/resources/records.ts)"
---

A person who may edit roles or people over AHP gives only the grants they hold. Both doors onto the users file keep the rule the command line keeps. The doors are the `x-ahpd/users` and `x-ahpd/roles` commands, and resource writes on `user://` and `role://`.

## What was built

- [`code://packages/sdk/src/resources/records.ts`](../../../../packages/sdk/src/resources/records.ts) - `Records.bound`, which `putRecord` and `removeRecord` ask before they write, and the resource `write` and `remove` that pass their `reader`.
- [`code://packages/sdk/src/resources/recordschannel.ts`](../../../../packages/sdk/src/resources/recordschannel.ts) - the `put` and `remove` commands pass their `reader`.
- [`code://packages/sdk/src/access/people.ts`](../../../../packages/sdk/src/access/people.ts) - the bound of the `user` and `role` records.
- [`code://packages/sdk/test/people-bound.test.ts`](../../../../packages/sdk/test/people-bound.test.ts) - eight cases, each through both doors.
- [`code://docs/sdk/USERS.md`](../../../../docs/sdk/USERS.md) - the `user` and `role` rows.

## Verified

- `people-bound.test.ts` passes 8 of 8 on a real host.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- `pnpm --filter @ahpd/sdk test` passes 4092, and `pnpm --filter @ahpd/server test` passes 1757.
- On 2026-11-03, a daemon of this branch on a test port refused `mo`, a manager, at each step of the escalation:
  - a role `boss` with `*:*`, through the command and through `role://boss`;
  - his own role as `*:*`;
  - the role `admin` for himself.
- The same daemon let `mo` write a role of `user:read`.

## Departures from the plan

- The test role holds `user:delete` and `role:delete` too. Without them the gate refuses a removal before the bound runs.
- `putRecord` asks `bound` only where a scheme has one. An unconditional `await` reordered a policy write and the read after it.
- A new person whose body names no roles is made `guest`, so the bound counts the grants of `guest`. The review added this case and its test.

## Left for later

- none.
