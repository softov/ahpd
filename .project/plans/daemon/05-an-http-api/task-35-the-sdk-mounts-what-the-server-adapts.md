---
title: The SDK mounts the Node listener the server adapts, and node-pty is the server's
status: done
depends: [task-16-the-api-on-bun-and-deno.md]
layer: "sdk | server"
refs:
  - "[decisions/the-sdk-mounts-the-node-listener-the-server-adapts.md](../../../decisions/the-sdk-mounts-the-node-listener-the-server-adapts.md) - what this task applies"
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) - `nodeListener`, which imports `@cofold/remote`, and its two callers"
  - "[code://packages/sdk/src/types/listen.ts](../../../../packages/sdk/src/types/listen.ts) - `ListenOptions.request` and `RequestsOptions`"
  - "[code://packages/sdk/package.json](../../../../packages/sdk/package.json) - `@cofold/remote` in `optionalDependencies`"
  - "[code://packages/server/src/pty.ts#L11](../../../../packages/server/src/pty.ts#L11) - the one import of `node-pty`, which the server does not declare"
  - "[code://packages/server/src/http.ts](../../../../packages/server/src/http.ts) - `listenApi`"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - the `request` passed to `listen`"
---

## Objective

`@ahpd/sdk` has no `@cofold/*` dependency, `node-pty` is declared by `@ahpd/server`, which imports it, and the API is still served on Node, Bun and Deno on both port modes.

## Files

- `UPDATE: packages/sdk/package.json`, `packages/server/package.json`, `pnpm-lock.yaml` - `@cofold/remote` leaves the SDK, and `node-pty` moves from the SDK's `optionalDependencies` to the server's.
- `UPDATE: packages/sdk/src/types/listen.ts` - the options carry the fetch-style handler and a Node listener beside it.
- `UPDATE: packages/sdk/src/listen.ts` - `nodeListener` goes; on Node `listen` and `serveRequests` mount the listener they were handed, and refuse when a handler came without one.
- `UPDATE: packages/server/src/http.ts`, `packages/server/src/commands/run.ts` - build the Node listener with `toNodeListener` and pass both.
- `UPDATE: packages/sdk/test/`, `packages/server/test/` - the cases below.

## Steps

1. Move the adapter to the server and change the option shape; keep Bun and Deno as task 16 left them.
2. Move `node-pty`, and check that a daemon still gets a pseudoterminal shell.
3. Check `pnpm boundary` shows the SDK's dependencies without `@cofold/remote` or `node-pty`.

## Validation

- A case: `listen` on Node with a handler and no Node listener rejects with a sentence naming what is missing.
- `server-http.test.ts` stays green, and the task 16 by-hand runs on Node, Bun and Deno, both port modes, pass again from the built output.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Built 2026-09-28.
`@ahpd/sdk` declares only `ws` and its protocol peer: `@cofold/remote` left it, and `node-pty` moved to `@ahpd/server`'s `optionalDependencies`, where `pty.ts` imports it.
`ListenOptions` and `RequestsOptions` carry `nodeRequest`, a `NodeRequestListener` beside the fetch-style `request`, and `nodeListener` is gone.
On Node, `listen` and `serveRequests` mount the `nodeRequest` they were handed, and `mountable` refuses a handler that came without one with a sentence naming `nodeRequest`; Bun and Deno are as task 16 left them.
`plainRequests(handler)` in `packages/server/src/http.ts` builds both shapes with `toNodeListener`, `run.ts` spreads it into `listen`, and `listenApi` passes its `nodeRequest` to `serveRequests`.
Two cases in `packages/sdk/test/listen.test.ts`: `listen` and `serveRequests` on Node reject a handler with no `nodeRequest`, and `listen` serves plain requests through the `nodeRequest` it was handed while the WebSocket still opens; both failed first.
The task 16 refs were re-pointed to the lines as they are now.
`pnpm boundary` lists `@ahpd/sdk` with 2 declared and `@ahpd/server` with 6.
A daemon still gets a pseudoterminal: `pty()` from the built `packages/server/dist/pty.js` loaded `node-pty` from the server's own `node_modules`, and `shellTerminals` over it opened a shell whose state said `isPty: true` and whose `tty` printed `/dev/pts/N`.
By hand from `packages/server/dist/main.js` with `http: true`, a connection token and a users file, on `node`, `bun` and `deno run -A`: `/api/status` answered 200 with the token and 401 without, `ahpd --remote <url> --token <token> user list` listed the person, `Host: a b` and `%E0%A4%A` answered 400, a foreign `Host` 403, and the WebSocket opened.
The same with `http: { "port": <other> }` on all three, where the daemon's own port answered 404 for `/api/status` and 426 for `/`.
With `http` off, all three answered 404 for `/api/status`, 426 for `/` and 400 for `Host: a b`, and kept answering.
`pnpm typecheck` and `pnpm boundary` green; `pnpm test` green, 106 files and 1496 tests.
