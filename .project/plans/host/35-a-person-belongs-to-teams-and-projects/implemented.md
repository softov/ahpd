---
title: A person belongs to teams and projects, and work names which one it is for - implemented
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/scopes.ts](../../../../packages/sdk/src/scopes.ts)"
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts)"
  - "[code://packages/server/src/commands/teams.ts](../../../../packages/server/src/commands/teams.ts)"
---

The users file names teams and projects, and each person holds memberships (`team:project`, `team:*`, `team`) and an optional primary; a session picks its team and project in a `scope` picker that is fixed after the first turn, and `scopeFor` gives the proxy the same answer.

## What was built

- [`code://packages/sdk/src/types/users.ts`](../../../../packages/sdk/src/types/users.ts) - `teams` and `projects` in the file, `memberships` and `primary` on a person and a principal, and the `Users` calls that add, list and remove teams and projects.
- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - reads and checks them; an entry naming nothing is reported and ignored by the read and kept as written by every write.
- [`code://packages/sdk/src/scopes.ts`](../../../../packages/sdk/src/scopes.ts) - `membership`, `covers` and `scopeFor`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the `scope` session key, charged at the first turn, kept with the session, never handed to a backend.
- [`code://packages/server/src/commands/teams.ts`](../../../../packages/server/src/commands/teams.ts) and `user.ts` - `team` and `project` add, list, rm; `user member`, `user primary`, and `--membership` / `--primary` on `user add`.

## Verified

- `scopes.test.ts`, `session-scope.test.ts`, `users.test.ts`, `sessions.test.ts`, `server-commands.test.ts`, `server-cli.test.ts`.
- Rebased on `31ec49c`: `pnpm exec tsc --noEmit` clean; `pnpm test` 136 files, 2037 tests passed.

## Departures from the plan

- While the users file names no team, or a directory does not say which teams there are, work is charged to nothing, as on a host with no directory (Softov, 2026-10-01: "Charge nothing if no teams").
- A session a host with people runs for nobody (root, an automation) is stored as charged to nothing, so a resumed one is not charged to whoever sends its next turn. One stored with no answer is decided at its next turn.
- A primary left behind by a new membership list is dropped rather than refused; a primary must name a project the file holds.
- `team:*` offers every project the file names: a project belongs to no team.
- Team and project ids may not hold a space, a colon or a star.
- `user member` and `user primary` take `--unset`; over `/api` an empty list clears memberships. `ahpd user member <id> --unset` cannot be typed yet, because `@cofold/commands@0.2.2` cannot register an optional variadic slot (`:entries?...`); it needs a cofold fix.
- Respawned backends are given only their own keys, never `scope` or the other host keys.

## Left for later

- A scope change is resolved against whoever sends it, not the session's owner: host 34.
- The grants are still `users:read` / `users:write`: host 36.
