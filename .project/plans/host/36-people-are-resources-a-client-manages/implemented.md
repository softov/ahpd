---
title: Users, teams, projects and roles are resources a client lists and edits - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/people.ts](../../../../packages/sdk/src/people.ts)"
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts)"
---

A host with a users directory serves `user://`, `team://`, `project://` and `role://` as resource schemes, each advertised in `_meta` with its create form and guarded by its own grant subject, so a client lists and edits people the way it does computers; a signed-in person reads their own record without a grant.

## What was built

- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - `SUBJECTS` gains `user`, `team`, `project` and `role` in place of `users`; an old `users:read` or `users:write` reads as the `user` subject only, said once per role.
- `Users` gains `roles`, `addRole` and `removeRole` (refused while a record names the role), and `add` takes `rolesFrom`.
- [`code://packages/sdk/src/people.ts`](../../../../packages/sdk/src/people.ts) - `peopleProviders(users)`, one provider per scheme with `describe()`; reads and lists never carry a token.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `ownRecord` lets a person read `user://<self>` without `user:read`.
- The daemon registers the four when it has a directory; the `user`, `team` and `project` commands move to the new subjects; `docs/USERS.md` and `docs/DAEMON.md` say so.

## Verified

- `packages/sdk/test/people.test.ts` (10 cases): each scheme's list, read, create, edit, remove and refusals, bodies that are not JSON objects, `createOnly`, no token after a real mint, the `_meta` advertisement, each scheme asking its own subject, and the own-record read.
- `packages/sdk/test/users.test.ts`: an old `users:write` role reads as `user:write`, said once, refused teams and projects.
- `packages/server/test/server-commands.test.ts`: `/api` answers each command under its own subject only.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 147 files, 2146 tests passed; `pnpm boundary` clean.

## Departures from the plan

- No built-in role named `users:*`, so there was nothing to rewrite.
- `user list` needs `role:read` as well as `user:read`, because it shows each person's roles.
- A body whose `id` disagrees with the URI is ignored rather than refused, and one write both creates and edits.

## Left for later

- The client screen: ahpapp people/01.
