---
title: The daemon mounts the API when http is on
status: todo
depends: [task-01-serve-in-cofold-remote.md]
layer: "server | sdk"
refs:
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) - the listener"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the configuration"
---

## Objective

`http: true` or `http: { port }` in the configuration mounts `serve()` over the command registry at `/api` on the daemon's listener, or on its own listener at `http.port`; without it `/api` is 404.

## Files

- `UPDATE: packages/server/src/config.ts` - `http`.
- `UPDATE: packages/sdk/src/listen.ts` - a request handler beside the upgrade.
- `UPDATE: packages/server/src/main.ts` - the mount.
- `UPDATE: packages/server/package.json` - `@cofold/remote`.

## Steps

1. The WebSocket upgrade path is untouched.

## Validation

- `test/server-http.test.ts`: off is 404; on answers `/api/cli-manifest`; `http.port` listens separately.

## Resume
