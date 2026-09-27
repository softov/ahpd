---
title: Each served command needs its own grant, and config hides the token
status: done
depends: [task-08-served-commands-act-on-the-daemons-own-options.md]
layer: "server | sdk"
refs:
  - "[decisions/status-and-plugin-list-need-config-read.md](../../../decisions/status-and-plugin-list-need-config-read.md) - `config:read`"
  - "[decisions/the-user-commands-need-users-write.md](../../../decisions/the-user-commands-need-users-write.md) - `users:write`"
  - "[decisions/installing-a-plugin-over-http-is-root-only.md](../../../decisions/installing-a-plugin-over-http-is-root-only.md) - the deployment token only"
  - "[decisions/the-config-command-hides-the-connection-token.md](../../../decisions/the-config-command-hides-the-connection-token.md) - no `connectionToken` value"
  - "[code://packages/sdk/src/users.ts#L35](../../../../packages/sdk/src/users.ts#L35) - `SUBJECTS`, which now has `users`"
  - "[code://packages/server/src/commands/scopes.ts#L17-L45](../../../../packages/server/src/commands/scopes.ts#L17-L45) - the mark and the hook that reads it"
  - "[code://packages/server/src/commands/plugin.ts#L26](../../../../packages/server/src/commands/plugin.ts#L26) and [#L54-L56](../../../../packages/server/src/commands/plugin.ts#L54-L56) - `config:read` on the list, and the deployment-token mark on install and remove"
  - "[code://packages/server/src/commands/config.ts#L15-L36](../../../../packages/server/src/commands/config.ts#L15-L36) and [#L53-L56](../../../../packages/server/src/commands/config.ts#L53-L56) - `withoutSecrets`, and the served answer"
  - "[code://packages/sdk/test/users.test.ts#L186-L196](../../../../packages/sdk/test/users.test.ts#L186-L196) - `users:write` as a grant"
  - "[code://packages/server/test/server-http.test.ts#L420-L563](../../../../packages/server/test/server-http.test.ts#L420-L563) - the cases under `a request signs in`"
---

## Objective

This task starts after daemon/04's task that moves the scope check into the registry's `authorize` hook ([daemon/04 task 14](../04-commands-declared-once/task-14-the-registry-hook-checks-every-surface.md)); the grants below are applied there, and `authorizeOverHttp` only turns a request into a principal.

`status` and `plugin list` need `config:read`, the `user` verbs need `users:write`, `plugin install` and `plugin remove` are served only to the deployment token, and `GET /api/config` never returns the `connectionToken` value.

## Files

- `UPDATE: packages/sdk/src/users.ts:35` - `SUBJECTS` gains `users`.
- `UPDATE: packages/server/src/commands/status.ts:23` and `plugin.ts:26` - `scopes: ['config:read']`; today none.
- `UPDATE: packages/server/src/commands/plugin.ts:54-56` - install and remove carry `meta.deploymentTokenOnly`; today `config:write` alone.
- `UPDATE: packages/server/src/commands/user.ts` - `scopes: ['users:write']` in place of `['admin']` on all four.
- `UPDATE: packages/server/src/commands/scopes.ts:17-45` - the `CommandMeta` mark, and the hook reading it before the scopes.
- `UPDATE: packages/server/src/commands/authorize.ts` - `ROOT` and `isRoot`, so the hook can tell the host from a person.
- `UPDATE: packages/server/src/commands/config.ts:15-36, 53-56` - on the remote surface the answer carries `connectionToken` as present, without its value.
- `UPDATE: packages/sdk/test/users.test.ts:186-196` - `users:write` is a grant a role may hold.
- `UPDATE: packages/server/test/server-http.test.ts:420-563` - the cases below.
- `UPDATE: packages/server/test/server-commands.test.ts` - the scopes the registry pins.

## Steps

1. Add `users` to `SUBJECTS` (decision `the-user-commands-need-users-write`), and change the four `user` scopes.
2. Add `config:read` to `status` and `plugin list` (decision `status-and-plugin-list-need-config-read`).
3. Mark `plugin install` and `plugin remove` in their declaration, and have the registry's `authorize` hook read the mark: the deployment token passes, and a person is refused with 403 and a sentence that names them and says only the deployment token may (decision `installing-a-plugin-over-http-is-root-only`).
4. `authorizeOverHttp` resolves the principal (root, or the person `users.verify` answered) and keeps only the 401s; the principal reaches the registry's hook the way daemon/04's task passes it, and the 403s come from the hook, with `refusalReason`.
5. Strip the `connectionToken` value from the remote answer of `config` (decision `the-config-command-hides-the-connection-token`); the terminal keeps printing the file.
6. The daemon/04 plan's scope row (`status` and `plugin list` need nothing, `user` needs `admin`) is replaced by these decisions; the code follows these.

## Validation

- `packages/server/test/server-http.test.ts`: a `member` is refused `GET /api/status` and `GET /api/plugin/list` with 403 and `ada may not config:read here`; today both answer 200.
- A role holding only `users:write` gets 200 from `GET /api/user/list`; today 403, since only `*:*` matches `admin`.
- An `admin` person is refused `POST /api/plugin/install` with 403 and the command does not run; today it runs `npm install`. The deployment token is not refused by the gate.
- With `connectionToken` in the configuration file, `GET /api/config` for a person holding `config:write` does not contain the secret; today it does.
- `packages/sdk/test/users.test.ts`: `isGrant('users:write')` and a role naming it resolves.
- `pnpm typecheck` green.

## Resume

Done.
`users` is in `SUBJECTS`, the four `user` verbs declare `users:write`, and `status` and `plugin list` declare `config:read`.
`plugin.install` and `plugin.remove` carry `meta.deploymentTokenOnly`, a mark declared by augmenting cofold's `CommandMeta` in `scopes.ts`; the hook refuses a person with `${id} may not install or remove a plugin here; only the deployment token may`, and `ROOT`/`isRoot` in `authorize.ts` is how it tells the host from a person.
`GET /api/config` answers `connectionToken: "<set>"` served, and the terminal still prints the file as it stands.
The scopes `packages/server/test/server-commands.test.ts` pins were updated with them.
`pnpm typecheck` green; `server-http`, `server-commands` and `users` green, 55 cases.
