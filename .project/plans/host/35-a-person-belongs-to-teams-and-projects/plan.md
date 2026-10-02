---
title: A person belongs to teams and projects, and work names which one it is for
domain: host
status: planned
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires: []
decisions:
  - decisions/teams-and-projects-are-memberships-in-the-users-file.md
  - decisions/a-request-naming-no-scope-uses-the-persons-primary.md
refs:
  - "[code://packages/sdk/src/types/users.ts#L84-L115](../../../../packages/sdk/src/types/users.ts#L84-L115) - `UserRecord`"
  - "[code://packages/sdk/src/types/users.ts#L157-L162](../../../../packages/sdk/src/types/users.ts#L157-L162) - `UserFile`"
  - "[code://packages/sdk/src/users.ts#L215-L266](../../../../packages/sdk/src/users.ts#L215-L266) - `fileUsers` reads the file on every question"
  - "[code://packages/server/src/commands/user.ts#L93-L170](../../../../packages/server/src/commands/user.ts#L93-L170) - the `user` commands, CLI and `/api`"
  - "[code://packages/sdk/src/types/host.ts#L218](../../../../packages/sdk/src/types/host.ts#L218) - `sessionConfig`, where a session key is declared"
---

## Goal

The users file defines teams and projects, and each person holds memberships written `team:project`, `team:*` or `team`, with an optional primary.
Any piece of work, a proxy request or an AHP session, resolves to one team and project from what it names or from the person's primary, so usage can be charged to them.
A project is a name, not a folder: it may span several repositories or none.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
users file (teams, projects, memberships, primary) -> Principal -> scopeFor(principal, named?) -> { team, project? } or a refusal
AHP: session picker `scope` (fixed after the first turn) -> scopeFor ; proxy: header or query -> scopeFor (in the proxy listener plan)
```

### Gaps

- No team, project or membership anywhere.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [Teams and projects are memberships in the users file, written team:project](../../../decisions/teams-and-projects-are-memberships-in-the-users-file.md) | Softov, 2026-10-01 |
| [A request that names no team and project uses the person's primary](../../../decisions/a-request-naming-no-scope-uses-the-persons-primary.md) | Softov, 2026-10-01 |

| What | Source | Task |
| --- | --- | --- |
| An AHP session picks its scope in a picker, settable until the first turn and fixed after | Softov, 2026-10-01, asked "On AHP, when is a session's team:project chosen?": "Picker, fixed after first turn" | 04 |
| A project may later list repositories; it starts as an id and a title | Softov, 2026-10-01: "A project is not just one git folder... eventually a project could have many git as needed or none." | 01 |
| A person sets their own primary; changing someone else's needs `users:write` | (defaulted: "the default one setted by the user") | 03 |

## Proposed architecture

- **Data flow** - `UserFile` gains `teams` and `projects`; `UserRecord` gains `memberships` and `primary`; the principal carries both.
- **Layer responsibilities** - `packages/sdk`: types, validation, `scopeFor`, the session key · `packages/server`: the commands.
- **Source-of-truth files** - [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts), `CREATE: packages/sdk/src/scopes.ts`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Teams, projects and memberships in the users file](task-01-file.md) | todo | - |
| [02 - A scope is resolved from what work names, or the primary](task-02-resolve.md) | todo | 01 |
| [03 - Commands for teams, projects and memberships](task-03-commands.md) | todo | 01 |
| [04 - A session picks its scope](task-04-session-picker.md) | todo | 02 |

## Risks and tradeoffs

- A membership that names a removed team or project is reported and ignored, like a role that names nothing.
- The proxy reads the header and query string in its own listener plan; this plan gives it `scopeFor`.

## Resume state

- **Done so far:** planned 2026-10-01.
- **Next action:** [task-01-file.md](task-01-file.md).
- **Open questions:**
  1. The proxy header and query names? - proposed: `X-AHP-Scope` and `?scope=`, both `team:project`.
- **Watch out for:** a malformed users file fails closed and refuses writes; new keys must keep that.

## Final verification checklist

- [ ] A person with `backend:*` and `frontend:controllr` and primary `backend:ahpd` resolves nothing named to `backend:ahpd`, `frontend:controllr` to itself, and `frontend:other` to a refusal.
- [ ] `plans/index.md` updated.
