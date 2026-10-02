---
title: Users, teams, projects and roles are resources a client lists and edits
domain: host
status: built
priority: medium
created: 2026-10-01
revalidated: 2026-10-02
requires:
  - plans/host/35-a-person-belongs-to-teams-and-projects/plan.md
decisions:
  - decisions/people-are-resource-schemes-with-a-grant-each.md
  - decisions/a-legacy-users-grant-is-the-user-subject-only.md
refs:
  - "[code://packages/sdk/src/users.ts#L23-L39](../../../../packages/sdk/src/users.ts#L23-L39) - the built-in roles and `SUBJECTS`"
  - "[code://packages/sdk/src/types/resources.ts#L214-L238](../../../../packages/sdk/src/types/resources.ts#L214-L238) - `SchemeDescription` and `ResourceProvider`, the shape each scheme implements"
  - "[code://packages/sdk/src/host.ts#L5364-L5378](../../../../packages/sdk/src/host.ts#L5364-L5378) - `advertisedSchemes`, which already advertises any registered scheme"
  - "[code://packages/computer/src/plugin.ts#L366](../../../../packages/computer/src/plugin.ts#L366) - `computer:`, the provider to mirror"
  - "[code://packages/server/src/commands/user.ts](../../../../packages/server/src/commands/user.ts) - the `user` commands and their `users:write` scope"
---

## Goal

A client with `team:read` lists teams, and one with `team:write` creates, edits and removes them, through the same resource calls and `_meta` advertisement ahpapp already uses for computers; the same for users, projects and roles.
A root on a fresh host can set up teams, users and roles from the app.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
client resourceList/Read/Write/Delete user://, team://, project://, role://
  -> host routes by scheme -> people provider -> Users port (fileUsers) -> users file
```

### Gaps

- People are reachable only from the CLI and `/api`.
- One `users` subject covers all of it.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [Users, teams, projects and roles are resource schemes, each with its own grant subject](../../../decisions/people-are-resource-schemes-with-a-grant-each.md) | Softov, 2026-10-01 |
| [An existing `users:*` grant is `user:*` only, said once at start per role](../../../decisions/a-legacy-users-grant-is-the-user-subject-only.md) | Softov, 2026-10-02 |

| What | Source | Task |
| --- | --- | --- |
| `write` on a scheme covers create, edit and delete | Softov, 2026-10-01: "Write covers delete" | 02 |
| The schemes are served only when the host has a users directory | (defaulted: there is nothing to list without one) | 02 |
| A signed-in person reads their own `user://<id>` record and memberships without `user:read`; listing others and any write need the grant | Softov, 2026-10-02, asked "can a signed-in person read their own user record without a `user:read` grant?": "Yes, own only" | 02 |

## Proposed architecture

- **Data flow** - each scheme's provider reads and writes through the `Users` port; a record is read as JSON and written as the JSON of the record.
- **Layer responsibilities** - `packages/sdk`: the subjects, the four providers · `packages/server`: the daemon registers them, the commands move to the new subjects · ahpapp: its own plan, a people screen like the computers one.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Each scheme is its own grant subject](task-01-subjects.md) | done | - |
| [02 - The host serves the four schemes](task-02-schemes.md) | done | 01 |
| [03 - Docs](task-03-docs.md) | done | 02 |

## Risks and tradeoffs

- An existing users file with `users:read` or `users:write` must keep working; see the open question.
- A person removed while signed in keeps their connection until it next verifies, as today.

## Resume state

- **Done so far:** all three tasks; see [implemented.md](implemented.md).
- **Next action:** none; the client screen is ahpapp people/01.
- **Open questions:** none.

## Final verification checklist

- [x] With `team:read` only, a client lists `team://` and is refused a write; with `team:write` it creates, edits and removes a team. `people.test.ts`, `asks each scheme for the subject that is its name`.
- [x] A person with no `user:read` reads their own record and is refused another's. `people.test.ts`, `answers a signed-in person their own record, and refuses them another's`.
- [x] A role with `users:write` edits users and not teams after the upgrade, and the daemon says so once. `users.test.ts`, `reads an old users grant as the user subject, and says so once per role`.
- [x] A root creates a team, a project, a role and a user over the resource calls, and the CLI lists them. The first half is `people.test.ts` over the four schemes against a real directory; the CLI half is what task 01's `/api` and `ahpd team`/`ahpd project`/`ahpd user` tests already hold, since the schemes and the commands are one directory.
- [x] `plans/index.md` updated.
