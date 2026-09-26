---
title: The API checks Origin and Host, and takes only JSON bodies
status: todo
depends: [task-07-the-listener-survives-a-malformed-request.md, task-12-http-host.md]
layer: "server"
refs:
  - "[decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) - what this task applies, and the daemon's own origins"
  - "[code://packages/server/src/http.ts#L53-L62](../../../../packages/server/src/http.ts#L53-L62) - `apiHandler`, where every API request enters"
  - "[code://packages/server/src/commands/run.ts#L86-L93](../../../../packages/server/src/commands/run.ts#L86-L93) - `advertisedResource`, whose host is one of the daemon's origins"
---

## Objective

An API request whose `Host` is not one of the daemon's own origins, or whose `Origin` is present and is not one of them, is refused with 403 before it is routed.
A request with a body whose `content-type` is not `application/json` is answered 415, in ahpd's own handler until `@cofold/remote@0.3.1` does it (task 06).

## Files

- `UPDATE: packages/server/src/http.ts:34-62` - `ApiOptions` carries the daemon's origins, and `apiHandler` checks them and the content type before `serve()`, the manifest included.
- `UPDATE: packages/server/src/commands/run.ts:154-166` - passes the origins: the loopback names at the port the API is bound to, the bound host at that port when it is a specific address, and the host of `resource` when one is configured; the bound port is known only after `listen`, so it is read lazily.
- `UPDATE: test/server-http.test.ts` - the cases below.

## Steps

1. The check and its 403 sentence in `http.ts`, applied to every path under `/api` (decision `the-http-api-checks-origin-and-host-and-takes-only-json`).
2. The 415 for a non-JSON body in the same place.

## Validation

- `test/server-http.test.ts`: with the deployment token, `Origin: https://evil.example` answers 403; today 200.
- With the deployment token, `Host: evil.example:<port>` (the DNS-rebinding shape) answers 403; today 200.
- With the deployment token, a `POST /api/user/add/x` with `content-type: application/x-www-form-urlencoded` answers 415; today it runs.
- No `Origin` and `Host: 127.0.0.1:<port>` or `localhost:<port>` answers 200, and `--remote` still works.
- With `resource: https://ahpd.example.com/`, `Host: ahpd.example.com` answers 200.

## Resume
