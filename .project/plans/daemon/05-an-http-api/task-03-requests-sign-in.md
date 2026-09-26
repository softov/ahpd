---
title: A request signs in and is checked against the grants
status: implemented
depends: [task-02-the-daemon-mounts-it.md]
layer: "server | sdk"
refs:
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts) - `verify`"
  - "[code://packages/sdk/src/host.ts#L141](../../../../packages/sdk/src/host.ts#L141) - `NEEDS` and the refusal reasons"
---

## Objective

The `authorize` hook reads `Authorization: Bearer <token>`: the connection token is root, anything else goes through the users path `authenticate` takes; a command's scopes are checked against the principal and a refusal carries the WebSocket's reason.

## Files

- `UPDATE: packages/server/src/commands/` - the `authorize` for the remote surface.
- `UPDATE: packages/sdk/src/index.ts` - export what the check needs, if it is not already.

## Steps

1. An unconfigured daemon (no users file) accepts the connection token only.

## Validation

- `test/server-http.test.ts`: no token 401, root token ok, a user without the grant 403 with the reason, a user with it ok.

## Resume

`packages/server/src/commands/authorize.ts` is the `authorize` hook `serve()` takes: it reads `Authorization: Bearer`, treats the deployment token as root, puts anything else through `users.verify` the way `authenticate` does, checks the command's scopes from `registry.scopesFor`, and refuses with `HttpError(401)` for no or unknown credentials and `HttpError(403)` carrying the WebSocket's sentence for a missing grant.
The sentence is now one export, `refusalReason` in `packages/sdk/src/host.ts` (exported from `packages/sdk/src/index.ts`), used by both the WebSocket gate and this hook, so the two cannot drift.
An unconfigured daemon with a token requires it; with neither a token nor a directory it keeps the gate it never had.
Commands exposed over HTTP no longer `process.exit` on the remote surface (`refuse` in `commands/options.ts`, plus `status` and `user rm`), so a refused request cannot end the daemon.
`test/server-http.test.ts` covers no-token 401, the deployment token, a member refused `config:write` with `ada may not config:write here`, and an admin answered.
