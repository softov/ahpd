---
title: One answer serves every tools server
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/tools/server.ts#L211-L264](../../../../packages/sdk/src/tools/server.ts#L211-L264) - `answered`, the JSON-RPC answer for one message"
  - "[code://packages/sdk/src/tools/server.ts#L330-L364](../../../../packages/sdk/src/tools/server.ts#L330-L364) - the method, body and notification checks of `request`"
  - "[code://packages/sdk/src/index.ts#L54](../../../../packages/sdk/src/index.ts#L54) - what the package exports from the server"
---

## Objective

One exported function answers a request against a list of tools, after the caller is known.
The session servers and `/mcp` both use it, and a session's server answers exactly as before.

## Files

- `UPDATE: packages/sdk/src/tools/server.ts:211-364` - move the method, body and message checks with `answered` into `answerTools`.
- `UPDATE: packages/sdk/src/index.ts:54` - export `answerTools`.
- `UPDATE: packages/sdk/test/toolserver.test.ts` - `answerTools` called on its own.

## Steps

1. Define `answerTools(request, serving, info)`, where `serving` holds `tools`, `runClient`, `toolsChanged` and `mayRun`.
2. Move the `GET`, method, JSON, batch and notification checks from `request` into it.
3. Keep the token check in `request`, before `answerTools`, so a wrong token learns nothing.
4. Let a `GET` with `toolsChanged: 'list'` answer 405, as today.
5. Call `answerTools` from `request` with the session's `Serving`.
6. Export `answerTools` and its options type from the package index.

## Validation

- `packages/sdk/test/toolserver.test.ts` and `packages/sdk/test/toolauth.test.ts` pass with no change to their existing cases.
- `packages/sdk/test/toolserver.test.ts` holds: `answerTools` answers `initialize`, `tools/list` and `tools/call` for a list of tools.
- `pnpm --filter @ahpd/sdk test -- toolserver` passes.
- `pnpm typecheck` passes.

## Resume

Built. `answerTools(request, serving, info)` holds the whole transport except who may ask: a `GET` is a stream for a serving that notifies and a 405 for one that does not, a non-`POST` is a 405, a body that is not one JSON-RPC message is a 400 - with -32700 for JSON that does not parse and -32600 for a batch - and a message with no `id` is answered 202. The three methods answer from `serving.tools` through the old `answered`. `request` keeps the path lookup and the timing-safe bearer check and then hands the request to `answerTools`, so a wrong token still learns nothing about the method or the body. The package index exports `answerTools`, `ToolsServing` and `ToolsInfo`.

Departures. `ToolsServing` is the name given to what a serving is, and it keeps `streams` optional so a caller such as `/mcp`, which never opens a stream, can pass the four fields alone; `Serving` stays private and requires all of them. `ToolsInfo` is exported rather than the `{ name: string; version: string }` literal being repeated at each call site, because task 04 builds one too. The new cases in `packages/sdk/test/toolserver.test.ts` live in their own describe block and call `answerTools` with no token and no path, which is what the function is now for; the existing cases are untouched and pass.

Gates: `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm -s boundary` pass; `packages/sdk/test/toolserver.test.ts` passes 27 of 27 and `packages/sdk/test/toolauth.test.ts` passes 4 of 4.
