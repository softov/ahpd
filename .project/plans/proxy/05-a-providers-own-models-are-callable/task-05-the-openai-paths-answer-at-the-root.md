---
title: The OpenAI paths answer at the root
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/proxy/dialects.ts#L16-L47](../../../../packages/server/src/proxy/dialects.ts#L16-L47) - `CALLER_PATHS`, `MODELS_PATH`, `ROOT_PATHS` and `dialectAt`"
  - "[code://packages/server/src/proxy/listener.ts#L793-L806](../../../../packages/server/src/proxy/listener.ts#L793-L806) - the path dispatch"
  - "[code://packages/server/src/http.ts#L128-L150](../../../../packages/server/src/http.ts#L128-L150) - `PROXY_PREFIX` and `withoutApi`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L124](../../../../packages/sdk/src/plugins/plugins.ts#L124) - `ROUTE_ROOT`"
---

## Objective

`POST /chat/completions` and `GET /models` answer as their `/v1` paths do.
`/v1/messages` stays the only Anthropic path, so `http://host:port` is the base URL for both SDKs.

## Files

- `UPDATE: packages/server/src/proxy/dialects.ts` - the root paths beside `CALLER_PATHS` and `MODELS_PATH`, and `dialectAt` reads both.
- `UPDATE: packages/server/src/proxy/listener.ts` - the dispatch takes the root paths as well as `/v1`.
- `UPDATE: packages/server/src/http.ts` - `withoutApi` sends the root proxy paths to the API handler, as it sends `/v1`.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - the root paths, `/messages` at the root, and a plugin route beside them.

## Steps

1. Add `ROOT_PATHS`, the OpenAI paths that also answer at the root: `/chat/completions` and `/models`.
2. Make `dialectAt` read `/chat/completions` as `openai-chat`.
3. Make the dispatch answer root `/models` as it answers `/v1/models`.
4. Make `withoutApi` send each root proxy path to the API handler.
5. Leave `/messages` at the root to the handler below, as today.
6. Test that an OpenAI call and a models list at the root answer as under `/v1`.
7. Test that `/messages` at the root is not the proxy.
8. Test that a plugin route under `/plugins` still answers beside the root paths.

## Validation

- `proxy-listener.test.ts` passes.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

- **Done so far:** `ROOT_PATHS` holds `/chat/completions` and `/models`, and `dialectAt` reads the chat path as `openai-chat`. The dispatch answers both root paths, and `withoutApi` sends them to the API handler as it sends `/v1`. Root `/models` answers in the header dialect, and a 405 names the path that was called. `/messages` at the root stays below. `proxy-listener.test.ts` covers both paths on a socket and on a real daemon, beside a `/plugins` route.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** `http.ts` now imports `ROOT_PATHS` from `proxy/dialects.ts`. Root paths are matched whole, so `/models/more` stays below.
