---
title: No one gives a grant they do not hold
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://ad352084 - the commit of ahpd this plan was checked at
  - "[code://packages/server/src/commands/user.ts#L24-L41](../../../../packages/server/src/commands/user.ts#L24-L41) - `bounded`, the rule the command line keeps and AHP does not"
  - "[code://packages/server/src/commands/user.ts#L155-L240](../../../../packages/server/src/commands/user.ts#L155-L240) - `user add`, `user rm` and `user token`, which bound the roles given and the person's own grants"
  - "[code://packages/sdk/src/resources/records.ts#L48-L70](../../../../packages/sdk/src/resources/records.ts#L48-L70) - `Records`, whose `put` and `drop` take no caller"
  - "[code://packages/sdk/src/resources/records.ts#L165-L192](../../../../packages/sdk/src/resources/records.ts#L165-L192) - `putRecord` and `removeRecord`, which every write goes through"
  - "[code://packages/sdk/src/resources/records.ts#L250-L280](../../../../packages/sdk/src/resources/records.ts#L250-L280) - the resource `write` and `remove` on `user://` and `role://`, which drop the `reader` they are given"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L384-L414](../../../../packages/sdk/src/resources/recordschannel.ts#L384-L414) - `x-ahpd/<domain>/put` and `remove`, which drop the `reader` they are given"
  - "[code://packages/sdk/src/access/people.ts#L77-L225](../../../../packages/sdk/src/access/people.ts#L77-L225) - the `user` and `role` records, where the bound is written"
  - "[code://packages/sdk/src/types/users.ts#L516-L518](../../../../packages/sdk/src/types/users.ts#L516-L518) - `grantsOfRoles` and `grantsOfPerson`, which the bound reads"
  - "[code://packages/sdk/src/host/gate.ts#L408](../../../../packages/sdk/src/host/gate.ts#L408) - `refusalReason`, the words of a refusal"
  - "[code://docs/sdk/USERS.md#L132-L135](../../../../docs/sdk/USERS.md#L132-L135) - the `user` row says the bound holds, and the `role` row says nothing"
---

## Goal

A person who may edit roles or people cannot give themselves, or anyone, a grant they do not hold.
Today a person with `role:put` can write a role with `*:*`, their own role included, and become admin.
A person with `user:put` can give any role.
The command line refuses both, and the AHP path that ahpw uses does not.
After this change every door onto the users file keeps the same rule as the command line.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "bounded\(" packages/server/src packages/sdk/src` - only the `user` and `token` commands call it.
- `rg -n "/put\`|/remove\`" packages/sdk/src packages/server/src` - `recordsMethods` builds `x-ahpd/users/put`, `x-ahpd/roles/put` and their `remove`.
- `rg -n "it\('.*(does not hold|may not give|escalat)" packages/sdk/test packages/server/test` - no test covers the bound over AHP.

### Runtime path

```
ahpw role editor -> x-ahpd/roles/put (reader: mo) -> recordsMethods.handle -> putRecord -> roles(directory).put -> users file
ahpw person page -> x-ahpd/users/put (reader: mo) -> recordsMethods.handle -> putRecord -> people(directory).put -> users file
resourceWrite role://boss (reader: mo) -> recordsProvider.write -> putRecord -> roles(directory).put -> users file
```

### Gaps

- On 2026-11-03, on a test daemon at `c97d8459`, a user `mo` with only `user:read`, `user:put`, `role:read` and `role:put` did each of these:
  - wrote a role `boss` with `*:*` through `x-ahpd/roles/put`;
  - gave himself `boss` through `x-ahpd/users/put`, and then read `x-ahpd-clients://`;
  - wrote his own role `manager` as `*:*`.
- `Records.put` and `Records.drop` take no caller, so no record can bound a write.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The AHP path keeps the rule the command line keeps: a caller gives only what it holds | Softov, 2026-11-03: "We need a urgent plan to fix those grants" | 01 |
| A role write is bounded by the role's new grants and by its grants now. A role removal is bounded by its grants now | (defaulted: `user add` bounds the person's grants now as well as the roles given, so editing what is above you is refused too) | 01 |
| A person write is bounded by the grants of the roles given and by the person's grants now. A person removal is bounded by the person's grants now | [code://packages/server/src/commands/user.ts#L165-L169](../../../../packages/server/src/commands/user.ts#L165-L169) | 01 |
| A caller is bounded through `reader.can(grant)`. An absent `reader` is a host with no users directory, and is not bounded | (defaulted: the root principal holds every grant, and `can` answers for it) | 01 |
| A refusal is `RpcError` `-32009` with `refusalReason(reader.id, grant)`, the first grant missing | (defaulted: the words a channel refusal already uses) | 01 |
| Teams, projects and policies are not bounded by this plan | (defaulted: their records hold no grants) | 01 |

## Proposed architecture

- **Data flow** - `putRecord` and `removeRecord` take the `reader`, and ask the record's `bound` before they write.
- **Layer responsibilities** - `@ahpd/sdk`: the bound in `people.ts`, the `reader` through `records.ts` and `recordschannel.ts` · docs: the `role` row of `USERS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/access/people.ts`](../../../../packages/sdk/src/access/people.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A write is bounded by the caller's grants](task-01-a-write-is-bounded-by-the-callers-grants.md) | todo | - |

## Risks and tradeoffs

- A custom role with `role:put` can no longer edit a role that holds more than it does - this is the fix. An admin still edits every role.
- `plans/host/20261103-1339-plugins-register-their-grants` changes `docs/sdk/USERS.md` too - each build edits other rows of it.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-write-is-bounded-by-the-callers-grants.md](task-01-a-write-is-bounded-by-the-callers-grants.md).
- **Open questions:** none.
- **Watch out for:** two doors reach the same records, the commands and the resource provider. Bound both, through `putRecord` and `removeRecord`, and test both.

## Final verification checklist

- [ ] `mo` with `role:put` cannot write a role with a grant he does not hold, through `x-ahpd/roles/put` or `role://`.
- [ ] `mo` cannot write his own role as `*:*`.
- [ ] `mo` with `user:put` cannot give a role whose grants he does not hold, through `x-ahpd/users/put` or `user://`.
- [ ] `mo` cannot edit or remove a person or a role that holds more than he does.
- [ ] `mo` can write a role, and give a role, made only of grants he holds.
- [ ] An admin and the root connection write any role and any person.
- [ ] `pnpm typecheck`, `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass.
