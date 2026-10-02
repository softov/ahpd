---
title: Users, teams, projects and roles are resources a client lists and edits
domain: host
status: planned
priority: medium
created: 2026-10-01
revalidated: 2026-10-01
requires:
  - plans/host/35-a-person-belongs-to-teams-and-projects/plan.md
decisions:
  - decisions/people-are-resource-schemes-with-a-grant-each.md
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

| What | Source | Task |
| --- | --- | --- |
| `write` on a scheme covers create, edit and delete | Softov, 2026-10-01: "Write covers delete" | 02 |
| The schemes are served only when the host has a users directory | (defaulted: there is nothing to list without one) | 02 |

## Proposed architecture

- **Data flow** - each scheme's provider reads and writes through the `Users` port; a record is read as JSON and written as the JSON of the record.
- **Layer responsibilities** - `packages/sdk`: the subjects, the four providers · `packages/server`: the daemon registers them, the commands move to the new subjects · ahpapp: its own plan, a people screen like the computers one.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Each scheme is its own grant subject](task-01-subjects.md) | todo | - |
| [02 - The host serves the four schemes](task-02-schemes.md) | todo | 01 |
| [03 - Docs](task-03-docs.md) | todo | 02 |

## Risks and tradeoffs

- An existing users file with `users:read` or `users:write` must keep working; see the open question.
- A person removed while signed in keeps their connection until it next verifies, as today.

## Resume state

- **Done so far:** planned 2026-10-01.
- **Next action:** [task-01-subjects.md](task-01-subjects.md), after host 35 is merged.
- **Open questions:**
  1. What does an existing `users:read` / `users:write` grant mean? - proposed: read as all four subjects' read / write, and reported once at start.
  2. May a person read their own `user:` record without `user:read`? - proposed: yes, their own only.
- **Watch out for:** a write never returns or lists a token.

## Final verification checklist

- [ ] With `team:read` only, a client lists `team://` and is refused a write; with `team:write` it creates, edits and removes a team.
- [ ] A root creates a team, a project, a role and a user over the resource calls, and the CLI lists them.
- [ ] `plans/index.md` updated.
