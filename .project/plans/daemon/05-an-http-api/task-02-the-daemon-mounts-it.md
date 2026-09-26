---
title: The daemon mounts the API when http is on
status: implemented
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

`http?: boolean | { port?: number }` in `packages/server/src/config.ts`, read into `Options.http` by `optionsFrom` with a value that is neither refused at startup.
`packages/server/src/http.ts` builds `serve(registry, program, { prefix: '/api', authorize })`, a 404 handler for the off case, and `listenApi` for `http.port`.
`packages/sdk/src/listen.ts` gained `ListenOptions.request`, wired on Node through `ws`'s `server:` option so the upgrade path is the literal one it was when no handler is passed.
`packages/server/src/commands/run.ts` mounts it and announces `http on http://<host>:<port>/api`; `@cofold/remote@^0.3.0` is in `packages/server/package.json`.
`test/server-http.test.ts` covers off-is-404, the manifest on the shared port, and `http.port` on its own listener.
