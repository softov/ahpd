---
title: Each served command needs its own grant, and config hides the token
status: todo
depends: [task-08-served-commands-act-on-the-daemons-own-options.md]
layer: "server | sdk"
refs:
  - "[decisions/status-and-plugin-list-need-config-read.md](../../../decisions/status-and-plugin-list-need-config-read.md) - `config:read`"
  - "[decisions/the-user-commands-need-users-write.md](../../../decisions/the-user-commands-need-users-write.md) - `users:write`"
  - "[decisions/installing-a-plugin-over-http-is-root-only.md](../../../decisions/installing-a-plugin-over-http-is-root-only.md) - the deployment token only"
  - "[decisions/the-config-command-hides-the-connection-token.md](../../../decisions/the-config-command-hides-the-connection-token.md) - no `connectionToken` value"
  - "[plans/daemon/04-commands-declared-once/task-14-the-registry-hook-checks-every-surface.md](../04-commands-declared-once/task-14-the-registry-hook-checks-every-surface.md) - daemon/04 task 14 moves the scope check into the registry's `authorize` hook, which this task depends on"
  - "[code://packages/server/src/commands/registry.ts#L118-L142](../../../../packages/server/src/commands/registry.ts#L118-L142) - the registries and their `authorize` hook, inert today"
  - "[code://packages/server/src/commands/authorize.ts#L59-L84](../../../../packages/server/src/commands/authorize.ts#L59-L84) - `authorizeOverHttp`, which checks scopes today and will only turn a request into a principal"
  - "[code://packages/sdk/src/host.ts#L321](../../../../packages/sdk/src/host.ts#L321) - `refusalReason`, the WebSocket's sentence"
---

## Objective

This task starts after daemon/04's task that moves the scope check into the registry's `authorize` hook ([daemon/04 task 14](../04-commands-declared-once/task-14-the-registry-hook-checks-every-surface.md)); the grants below are applied there, and `authorizeOverHttp` only turns a request into a principal.

`status` and `plugin list` need `config:read`, the `user` verbs need `users:write`, `plugin install` and `plugin remove` are served only to the deployment token, and `GET /api/config` never returns the `connectionToken` value.

## Files

- `UPDATE: packages/sdk/src/users.ts:35` - `SUBJECTS` gains `users`.
- `UPDATE: packages/server/src/commands/status.ts:16-22` - declares `scopes: ['config:read']`; today none.
- `UPDATE: packages/server/src/commands/plugin.ts:20-26` - `plugin list` declares `config:read`; today none.
- `UPDATE: packages/server/src/commands/plugin.ts:38-48` - `plugin install` and `plugin remove` are marked served to the deployment token only; today `config:write`.
- `UPDATE: packages/server/src/commands/user.ts:59, 86, 110, 132` - `scopes: ['users:write']` in place of `['admin']`.
- `UPDATE: packages/server/src/commands/registry.ts:118-142` - the served registry's `authorize` hook reads the principal and checks the command's scopes and its deployment-token-only mark.
- `UPDATE: packages/server/src/commands/authorize.ts:59-84` - `authorizeOverHttp` resolves the Bearer token to the deployment's root or a person and hands that on; it checks no scope.
- `UPDATE: packages/server/src/commands/config.ts:68-85` - on the remote surface the answer carries `connectionToken` as present, without its value.
- `UPDATE: test/users.test.ts` - `users:write` is a grant a role may hold.
- `UPDATE: test/server-http.test.ts` - the cases below.

## Steps

1. Add `users` to `SUBJECTS` (decision `the-user-commands-need-users-write`), and change the four `user` scopes.
2. Add `config:read` to `status` and `plugin list` (decision `status-and-plugin-list-need-config-read`).
3. Mark `plugin install` and `plugin remove` in their declaration, and have the registry's `authorize` hook read the mark: the deployment token passes, and a person is refused with 403 and a sentence that names them and says only the deployment token may (decision `installing-a-plugin-over-http-is-root-only`).
4. `authorizeOverHttp` resolves the principal (root, or the person `users.verify` answered) and keeps only the 401s; the principal reaches the registry's hook the way daemon/04's task passes it, and the 403s come from the hook, with `refusalReason`.
5. Strip the `connectionToken` value from the remote answer of `config` (decision `the-config-command-hides-the-connection-token`); the terminal keeps printing the file.
6. The daemon/04 plan's scope row (`status` and `plugin list` need nothing, `user` needs `admin`) is replaced by these decisions; the code follows these.

## Validation

- `test/server-http.test.ts`: a `member` is refused `GET /api/status` and `GET /api/plugin/list` with 403 and `ada may not config:read here`; today both answer 200.
- A role holding only `users:write` gets 200 from `GET /api/user/list`; today 403, since only `*:*` matches `admin`.
- An `admin` person is refused `POST /api/plugin/install` with 403 and the command does not run; today it runs `npm install`. The deployment token is not refused by the gate.
- With `connectionToken` in the configuration file, `GET /api/config` for a person holding `config:write` does not contain the secret; today it does.
- `test/users.test.ts`: `isGrant('users:write')` and a role naming it resolves.
- `pnpm typecheck` green.

## Resume
