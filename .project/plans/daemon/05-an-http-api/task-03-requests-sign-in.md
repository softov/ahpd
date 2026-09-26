---
title: A request signs in and is checked against the grants
status: todo
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
