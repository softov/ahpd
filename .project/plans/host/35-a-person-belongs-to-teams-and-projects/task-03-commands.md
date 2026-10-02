---
title: Commands for teams, projects and memberships
status: done
depends: [task-01-file.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/user.ts#L93-L170](../../../../packages/server/src/commands/user.ts#L93-L170) - the `user` commands to mirror"
---

## Objective

`ahpd team add|rm|list`, `ahpd project add|rm|list`, `ahpd user member <id> <entries...>` and `ahpd user primary <id> <entry>`, each also under `/api`.

## Files

- `CREATE: packages/server/src/commands/teams.ts` - team and project commands, `users:write` to change, `users:read` to list.
- `UPDATE: packages/server/src/commands/user.ts` - `member` replaces a person's memberships; `primary` sets it, allowed for oneself without `users:write`; `list` shows both.
- `UPDATE: packages/server/src/commands/registry.ts`, `packages/server/src/commands/served.ts` - register.

## Steps

1. Removing a team or project in use is refused, naming who uses it.

## Validation

- `packages/server/test/server-commands.test.ts`: each command over the CLI and `/api`; a person sets their own primary; another's needs `users:write`.
- `pnpm -F @ahpd/server test`.

## Resume

- `commands/teams.ts` declares the six verbs twice over, once told it is `team` and once told it is `project`, so the two surfaces of each cannot drift. `users:read` lists, `users:write` changes; `people()` and `idOf()` come out of `user.ts` and are shared, which is why `idOf` now takes the whole command word (`user add`) rather than the bare verb.
- `user member <id> <entries...>` replaces the whole list and refuses an entry naming a team or a project the file does not hold; `user primary <id> <entry>` sets the primary and its declaration carries no grant, because the one question is whether the record is the caller's own, which a declaration cannot say. The body asks for `users:write` when it is not. `user list` shows both halves per person.
- The ports were extended: the task's file list names `teams.ts`, `user.ts`, `registry.ts` and `served.ts`, but nothing there could add, remove or list a team or a project without writing the users file itself. `Users` gained `teams()`, `projects()`, `addTeam()`, `addProject()`, `removeTeam()` and `removeProject()` beside `add`, and `add` gained `memberships` and `primary` in its options, each left alone when the call names none. They mirror `add`/`remove` in shape: an absent id answers `false`, an entry the file does not hold throws. The four hand-built `Users` fakes in `packages/sdk/test` grew the six empty methods, which the port makes mandatory.

Two things the plan does not settle, decided here:

- **A primary left behind by a new membership list is taken away, not refused.** Refusing makes the move impossible: a person on `backend:controllr` with `backend:*` cannot leave `backend` before they can name another membership, so the list they need first is the one that is refused. `add` therefore drops a primary the memberships it just wrote no longer cover, and the command says so on the line it prints, along with a `dropped` field in its data.
- **A primary is checked as a place as well as a membership.** `covers` alone would accept `backend:other` under a `backend:*` membership, and the read would drop it on the next turn as naming a project the file does not hold. A write does not leave the file holding something every read drops.

Three more, from the review of what was built:

- **The record fields are declared by the verb that writes them.** `--membership` and `--primary` were on every `user` verb and read by none of them: a flag a person can type that does nothing. They are on `user add` alone, which writes the whole record in one call, and `userFields` is the rest. The header of `user.ts` said every sub-command declares the same fields so a flag is accepted wherever on the line it is typed; that is still true of the file and the address, which is what every verb does accept.
- **An unset is spelled `--unset`, on both verbs that can take something away.** `plugin config <name> <key> --unset` is the house spelling and the two are the same question. Over `/api` a memberships list is cleared by an empty list and a primary by `{"unset": true}`: the first is a list and the second is one value, so a body that says nothing is a clear of the first and a request that says nothing of the second, which is refused rather than read as a clear. The `user primary` route moved from `/user/primary/{id}/{entry}` to `/user/primary/{id}` for this, since a path cannot say "none of those" and one HTTP binding per command is the rule.
- **`ahpd user member <id>` with no entry is not reachable and is `--unset` instead.** `@cofold/commands@0.2.2` reads `:entries?...` as an optional variadic in `parsePattern`, which the terminal matcher honours, but `commandFor` strips `:` , `...` and `?` as three separate end-anchored matches and so resolves that spelling to a field called `entries...`, which no declaration has: declaring it throws at build time. The one work-around available without a change to the library is `:entry?`, which takes one entry and no more, and that costs a terminal a person can no longer type `ahpd user member ada backend frontend`. The positional list is worth more than the two-word clear, so the flag is the clear.

`server-commands.test.ts` covers each of the eight verbs at the terminal and under `/api` (the served half through `apiHandler` and `servedRegistry`, so the route, the method and the body are what a request carries), naming and re-naming a team, removing what nobody holds, refusing to remove what a membership names and naming who, replacing a membership list, refusing an unknown team or project, setting and moving a primary, `user list` carrying both halves, and a person setting their own primary over `/api` with 403 on somebody else's and 401 with no credential. `server-cli.test.ts`'s bare-verb message was updated for the two new sub-commands.
