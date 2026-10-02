---
title: A scope is resolved from what work names, or the primary
status: done
depends: [task-01-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/users.ts#L40-L74](../../../../packages/sdk/src/types/users.ts#L40-L74) - `Principal`"
---

## Objective

`scopeFor(principal, named?)` answers `{ team, project? }` or a refusal that lists what the person can name.

## Files

- `CREATE: packages/sdk/src/scopes.ts` - `scopeFor` and the membership parser.
- `CREATE: packages/sdk/test/scopes.test.ts`.
- `UPDATE: packages/sdk/src/index.ts` - export it.

## Steps

1. Named: it must match a membership (`team:*` matches any project of that team; a bare `team` matches only team work); otherwise refuse. A named `team` under `team:*` alone is refused, since a project is needed.
2. Not named: the primary; else the only concrete membership; else refuse with the list.
3. No users directory or a root connection: no scope, nothing refused.

## Validation

- `scopes.test.ts`: the three cases of the plan's checklist, a bare team, `team:*` with and without a project named, no memberships at all.
- `pnpm -F @ahpd/sdk test`.

## Resume

- `scopes.ts` holds `Scope`, the membership parser (`membership`), `namesOf` and `scopeFor`; `index.ts` exports them and `scopes.test.ts` covers each case.
- `scopeFor(principal, named?)` takes the principal or nothing, so a host with no directory and a root connection answer `undefined` - no scope and no refusal - without a second rule for it at the call site.
- The refusal is one string naming what the person may name, and `namesOf` expands a `team:*` into the projects the install knows rather than quoting the wildcard: a refusal that said `luiz may name backend:*` would name nothing anybody can pick.
- One check the task does not state, because it follows from what a refusal has to be able to say: a named project the file does not define is refused even under a `backend:*` membership. A wildcard says any *known* project, and otherwise any spelling would be chargeable.
- `Principal` gained `projects` (task 01's file list gave it only memberships and primary). Without them a wildcard membership cannot be expanded into anything, and the plan's own runtime path reads `users file (teams, projects, memberships, primary) -> Principal`; task 04 step 1 needs the same list for the picker. Noted here as well as in task 01.

Two from the review of what was built, both settled by Softov on 2026-10-01:

- **A file that names no team at all is a host that has not been given the subject yet.** `scopeFor` refused anybody whose memberships did not resolve, so a fresh users file - a record per person, no `teams` key - refused every session's first turn with `belongs to no team and project, so there is nothing to charge`. It answers nothing at all instead, exactly as a host with no users directory does, and the refusal starts at the first team the file names. This needed a field: "the file defines no teams" is a fact about the file rather than about a person, and a principal that holds no memberships cannot say it, so `Principal.teams` carries the list and an absent one means the directory did not say.
- **A principal with no `projects` is a directory that does not know, not one that says there is none.** The check for a named project was written to refuse anything the file did not list, which is right for a `fileUsers` principal and wrong for one built by hand or by an embedder without a file. `undefined` skips the check and `[]` refuses, which is the distinction the type already draws.
