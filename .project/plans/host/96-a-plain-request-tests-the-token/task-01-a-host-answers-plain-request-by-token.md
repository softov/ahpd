---
title: A host answers a plain request by its token
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/listen.ts#L102-L126](../../../../packages/sdk/src/listen.ts#L102-L126) - `identityOf`"
  - "[code://packages/server/src/http.ts#L142-L149](../../../../packages/server/src/http.ts#L142-L149) - `withoutApi`"
---

## Objective

A plain request off `/api` and `/v1` gets 401 when the handshake would refuse its token, and 426 when it would accept it.
Both answers carry `Access-Control-Allow-Origin: *`.

## Files

- `UPDATE: packages/sdk/src/listen.ts:102-126` - the token check becomes a function that the plain answer and the handshake both call.
- `UPDATE: packages/sdk/src/listen.ts:141-152` - Bun: the plain answer is 401 or 426, with the header.
- `UPDATE: packages/sdk/src/listen.ts:209-212` - Deno: the same.
- `UPDATE: packages/sdk/src/listen.ts:296-302` - Node: the same, for a host with no HTTP surface.
- `UPDATE: packages/sdk/src/types/listen.ts:105` - the `request` doc says what a plain request gets.
- `UPDATE: packages/server/src/http.ts:142-149` - `withoutApi` takes the check and gives the same two answers.
- `UPDATE: packages/server/src/commands/run.ts:456-471` - the daemon hands the check to every handler that answers off `/api` and `/v1`.
- `UPDATE: packages/server/test/server-http.test.ts:486-492` - the 401, the 426 and the header, with the API on and off.
- `UPDATE: packages/sdk/test` - the test of `listen` holds the same cases.

## Steps

1. Read what a plain request off `/api` gets when `http` is on, and record it in Resume.
2. Move the token check of `listen.ts` into one exported function that takes the URL and the `authorization` header.
3. Make the handshake on each runtime call that function.
4. Answer a plain request with 401 and the handshake's sentence when the function refuses it.
5. Answer it with 426 when the function accepts it.
6. Add `Access-Control-Allow-Origin: *` to both answers.
7. Give `withoutApi` the same function, and give the same two answers off `/api` and `/v1`.
8. Keep the answers under `/api` and `/v1` as they are.
9. Write the tests.
10. Set this task and the plan row to `implemented`.

## Validation

- `server-http.test.ts`, with the API on and off: a wrong token gets 401 and a good one 426.
- `server-http.test.ts`: `/api` keeps its answer.
- The sdk test on Node: a wrong `?tkn=` gets 401, and a good one 426, each with the header.
- A host with no token answers 426 to a plain request.
- `pnpm -s build`, `pnpm -s typecheck`, `pnpm boundary` and the vitest gate pass.

## Resume

- **Done so far:** built 2026-10-16. `doorOf` in `packages/sdk/src/listen.ts` is the token check, and `listen` builds its door from it. `plainAnswer` answers a plain request by that door: 401 with `A connection token is required`, or 426, each with `Access-Control-Allow-Origin: *`. Bun, Deno and Node give that answer when the host has no HTTP surface. `withoutApi(door, api?)` gives it on the daemon's port off `/api` and `/v1`. It hands `/api` and `/v1` to the API when the API is on that port. `run.ts` builds one `DoorOptions` and passes it to `listen` and to `withoutApi`.
- **Next action:** build task 02.
- **Open questions:** none.
- **Watch out for:**
  - Step 1 found that with `http` on, a plain request off `/api` reached `serve()` of `@cofold/remote`, which answered 404 `No route for GET /`. That path now gets the 401 or the 426.
  - The API's own port, when `http.port` gives it one, is not a WebSocket port and keeps its 404 off `/api`.
  - On Bun the handshake's own 426 also carries the header.
  - Bun and Deno were checked by hand with a script against the built `listen`, because vitest runs on Node only.
