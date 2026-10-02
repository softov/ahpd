---
title: Teams, projects and memberships in the users file
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/users.ts#L84-L162](../../../../packages/sdk/src/types/users.ts#L84-L162) - `UserRecord` and `UserFile`"
  - "[code://packages/sdk/src/users.ts#L215-L266](../../../../packages/sdk/src/users.ts#L215-L266) - reading the file"
---

## Objective

The users file holds `teams` and `projects` (each an id and an optional title) and each person's `memberships` and `primary`, checked on read, and a `Principal` carries the memberships and primary.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:84-162` - `UserFile.teams?`, `UserFile.projects?`, `UserRecord.memberships?: string[]`, `UserRecord.primary?: string`; the same two on `Principal`.
- `UPDATE: packages/sdk/src/users.ts` - parse and check them; write them back unchanged.

## Steps

1. A membership is `team`, `team:*` or `team:project`; one naming an unknown team or project is reported once and ignored.
2. `primary` must be `team` or `team:project`, never `*`, and covered by a membership; otherwise reported and ignored.
3. A file without the new keys reads as today.

## Validation

- `packages/sdk/test/users.test.ts`: the forms parse; unknown names are ignored with a report; a bad primary is ignored; an old file reads.
- `pnpm -F @ahpd/sdk test`.

## Resume

- `types/users.ts` gained `Named` for a team or a project entry, `UserFile.teams?` and `.projects?`, `memberships?` and `primary?` on a record, and the same two read through on `Principal`.
- `users.ts` parses both lists and checks every membership on read: a form that is not `team`, `team:*` or `team:project`, a team the file does not define and a project the file does not define are each said once and dropped. `primary` is kept only when it is `team` or `team:project` and one of their memberships covers it - a `team:*` covers every project of that team, a bare `team` covers only a bare `team`, which is the matching rule task 02 resolves a named scope with, so the plan's own checklist (`backend:*` with primary `backend:ahpd`) is a file that reads.
- The two on a principal are getters, not stamped: the file is read on every question, so a membership somebody was added to while their socket is open is in the next picker.
- `write` carries `teams` and `projects` through unchanged, and `list` reports both halves per person.
- `users.test.ts` covers the three forms and the primary, an unknown team and an unknown project and a malformed entry each reported once, a primary that is a wildcard or another team's, a file written before the keys existed, the write-then-read round trip, and the re-read on a live principal.

One reading the plan did not spell out: `primary` is *covered by* a membership rather than being one of them. The plan's checklist has a primary of `backend:ahpd` beside memberships of `backend:*` and `frontend:controllr`, so `team:*` covers the projects of its team, while a bare `team` covers only a bare `team` - the rule task 02 states for a named scope, so a primary and a named scope cannot disagree.

Added afterwards, for tasks 02 and 04: `Principal.projects`. The plan's runtime path reads `users file (teams, projects, memberships, primary) -> Principal`, and both the refusal a task-02 scope names and the picker task 04 builds expand a `team:*` into the projects this install knows - which the memberships alone cannot say. It is a getter like the other two, and nothing else about a record changed.

Three more from the review of what was built:

- **A write does not settle what the read dropped.** Every writer builds the file it writes back from what `read` gave it, and `read` was handing back memberships and primaries it had decided meant nothing, so `user token` or `user add` on a record with a hand-written `sales` membership deleted that membership - and the file the operator was about to fix with `team add sales` was gone before the fix. `read` now carries the two as written and checks them only to report and to answer a `Principal`, and `add` checks only what the call names. An entry naming a team nobody has named yet is a team's next `team add`, not a mistake in whatever verb happened to write the file.
- **A primary is checked as a place as a membership is.** It was checked for the two membership rules and not for the third, so a `backend:ahpd` outlived the removal of the project `ahpd` and was neither dropped nor reported. `problemWith` now runs on it too, and `holders` counts a primary, so `project rm` and `team rm` refuse on one exactly as they refuse on a membership.
- **`problemWith` calls `membership()` rather than re-parsing.** The grammar was written twice, in `scopes.ts` and here, and the two had drifted. One parser, and this is its second reader.

`Principal.teams` was added for task 02, and is a getter like the other two. The plan's runtime path only carries memberships and primary into the principal, but "while the users file defines no teams at all" is a fact about the file rather than about a person, and a principal cannot say it without the list. Absent means the directory did not say, which is what a principal built by hand or an embedder without a file answers.
