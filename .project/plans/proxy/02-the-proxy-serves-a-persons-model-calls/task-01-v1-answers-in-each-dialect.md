---
title: /v1 answers in each dialect, and refuses in its own error shape
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L353-L394](../../../../packages/server/src/commands/run.ts#L353-L394) - the `/api` mount and `below`, where `/v1` is chained"
  - "[code://packages/server/src/http.ts#L77-L124](../../../../packages/server/src/http.ts#L77-L124) - `hostRefusal` and `foreign`, the guard `/v1` takes"
  - "[code://packages/server/src/http.ts#L221-L238](../../../../packages/server/src/http.ts#L221-L238) - `guarded`"
  - "[code://.project/decisions/the-proxy-answers-under-v1-beside-the-api.md](../../../decisions/the-proxy-answers-under-v1-beside-the-api.md) - where and when it is served"
---

## Objective

With `http` on, `POST /v1/chat/completions` is read as `openai-chat` and `POST /v1/messages` as `anthropic-messages` on the listener that carries `/api`, and every refusal is that dialect's own error body with a status its SDK maps to an error type.
With `http` off, `/v1` is the 404 `/api` gets.

## Files

- `CREATE: packages/server/src/proxy/dialects.ts` - per dialect: its path, its refusal body (`openai-chat`: `{ error: { message, type, param: null, code } }`; `anthropic-messages`: `{ type: 'error', error: { type, message } }`), and the status to error-type table (400 `invalid_request_error`, 401 `authentication_error`, 403 `permission_error`, 404 `not_found_error`, 405 `invalid_request_error`, 502 and 503 `api_error`, 504 `timeout_error`).
- `CREATE: packages/server/src/proxy/listener.ts` - `proxyHandler(options)`: the path to dialect, the guard, the body read, and a stub that answers 501 until task 04.
- `UPDATE: packages/server/src/commands/run.ts:353-394` - `/v1` chained in front of `api` on whichever listener carries it, both for the daemon's port and for `listenApi`.
- `CREATE: packages/server/test/proxy-listener.test.ts`.

## Steps

1. `/v1` is guarded like `/api`: `Host` by `hostRefusal`, `Origin` by `foreign`, and `127.0.0.1`, `localhost` and `[::1]` accepted at any port; the refusal is in the dialect's body, chosen by the path, and the plain JSON message for a path under `/v1` that is neither.
2. A body that is not JSON, or has no string `model`, is 400 in the dialect's body; a method other than `POST` on the two paths is 405 with `Allow: POST`.
3. A path under `/v1` that is not one of the three (`/chat/completions`, `/messages`, `/models`) is 404 in OpenAI's body, since no Anthropic client asks for another.

## Validation

- Failing first: `proxy-listener.test.ts` against a daemon with `http: true` gets 426 on `POST /v1/chat/completions` today; it then expects the dialect body.
- Each refusal: no JSON, no `model`, `GET` on `/v1/messages`, an unknown `/v1/foo`, a foreign `Host`, a foreign `Origin`; `Host: 127.0.0.1:<another port>` accepted; each body parses as its dialect's error shape and the status is the one in the table.
- With `http` off, `/v1/messages` is 404, as `/api` is.
- `pnpm -F @ahpd/server test`.

## Resume

Implemented 2026-10-06.
`proxyHandler` in `packages/server/src/proxy/listener.ts`, the dialect bodies in `dialects.ts`, the mount in `run.ts` in front of `api` on both listeners, and `withoutApi` answering `/v1` 404.
`hostRefusal`, `originRefusal`, `foreign`, `guarded`, `json`, `isUnder` and `PROXY_PREFIX` are exported from `http.ts`.
A body over 32 MiB is 413 (`request_too_large`), which the plan did not list; the refusal table gained 413 and 500.
Tests: `proxy-listener.test.ts`, the first describe and the daemon cases.
