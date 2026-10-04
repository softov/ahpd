---
title: A user put clears its issuer and roles-from when it says null
domain: host
status: built
priority: medium
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/36-people-are-resources-a-client-manages/plan.md
refs:
  - "[code://packages/sdk/src/people.ts#L158-L191](../../../../packages/sdk/src/people.ts#L158-L191) - the `user:` manifest and `put`: `primary` is nullable and `null` clears it; `issuer` and `rolesFrom` go through `textOf`, so `null` keeps the old value"
  - "[code://packages/sdk/src/types/users.ts#L272-L284](../../../../packages/sdk/src/types/users.ts#L272-L284) - `Users.add`, whose options take `primary: string | null` and `issuer`/`rolesFrom` as strings only"
  - "[code://packages/sdk/src/users.ts#L714-L800](../../../../packages/sdk/src/users.ts#L714-L800) - the file's `add`, which deletes `primary` on `null` and only ever sets `issuer`/`rolesFrom`"
---

## Goal

A client that edits a person can take an issuer or a roles-from claim away again: a `user://<id>` put naming `issuer: null` or `rolesFrom: null` removes it from the record, a key the body leaves out keeps what the record had, the way `primary` already behaves.

## Reconnaissance

### Searches performed

- `rg -n "rolesFrom" packages/*/src` - `people.ts`, `users.ts`, `types/users.ts`, `server/src/commands/user.ts` (the CLI sets them, it never clears them; unchanged here).

### Runtime path

```
resourceWrite user://<id> -> people.ts put -> Users.add(options) -> users file record
```

### Gaps

- `null` and a blank string are both "not named" today, so ahpapp's user form cannot clear either field once set.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | none | - |

| What | Source | Task |
| --- | --- | --- |
| `issuer: null` and `rolesFrom: null` in a put clear the field; an absent key keeps it; the manifest marks both `nullable` | softov-c6, relaying Softov, 2026-10-03: "a `user://<id>` put should clear `issuer` and `rolesFrom` when the body says `null`, the way `primary` already does" | 01 |
| Clearing `issuer` does not clear `rolesFrom`, and the reverse | (defaulted: `primary` and `memberships` are cleared independently too, and the body names each one it means) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A null issuer or roles-from is taken away](task-01-a-null-issuer-or-roles-from-is-taken-away.md) | done | - |

## Risks and tradeoffs

- An older client never sends `null`, so nothing it does changes.

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
