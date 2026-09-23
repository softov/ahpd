---
title: A grant is a subject and a verb - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/users.ts
  - code://packages/sdk/src/types/index.ts
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/host.ts
  - code://packages/server/src/main.ts
  - code://test/users.test.ts
  - code://test/users-gate.test.ts
  - code://docs/USERS.md
---

Permission is a subject and a verb, so a role can grant looking without granting doing. `guest` - the default for a new person - lists the sessions and the automations and can do nothing about either, and `admin` is `*:*`, which reaches a plugin's scheme where before even an admin had to name it.

## What was built

- `code://packages/sdk/src/types/users.ts` - `Verb`, `Grant` as `${string}:${Verb | '*'}`, and `Users.list` answering the grants a role resolved to.
- `code://packages/sdk/src/users.ts` - `isGrant`, `holds` (exact, `*:*`, `*:<verb>`, `<subject>:*`), the built-ins `admin`/`member`/`guest`, the once-only report for a malformed grant and for a role nothing defines, the role-name refusal in `add`, and the grants in `list`.
- `code://packages/sdk/src/host.ts` - `NEEDS` by pair, `dispatchNeeds` as writes, and `capabilityFor` scoping only the `file` subject by the request's URI scheme.
- `code://packages/server/src/main.ts` - `guest` as the default, the refusal said as the verb's own, and `user list` printing `id (roles) grants`.
- `code://docs/USERS.md` - the grammar, the subject and verb table, the built-ins, the wildcard rule and the `user list` output.

## Verified

- `pnpm test`: 72 files, 936 tests. `test/users.test.ts` holds the built-ins, the wildcards, the malformed-grant report, the resolved grants and the role refusal; `test/users-gate.test.ts` holds the gate matrix in the new spelling.
- `pnpm typecheck` and `pnpm boundary` green.
- By hand: a daemon with a `guest`, connected at the door with that person's own token, listed sessions and automations and was refused a file read, a terminal, a session write and an automation write, each naming the grant.

## Departures from the plan

- None in behaviour. `Users.list` grew a `grants` field, which the plan named as "answers resolved grants" and which is the smallest way to keep the built-ins in one place.

## Left for later

- Nothing. The `watch` idea from the discussion before this plan is subsumed: `session:read` and `automation:read` are what it would have been.
