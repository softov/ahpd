---
title: The API checks Origin and Host, and takes only JSON bodies
status: done
depends: [task-07-the-listener-survives-a-malformed-request.md, task-12-http-host.md]
layer: "server"
refs:
  - "[The HTTP API checks Origin and Host, and takes only JSON bodies](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) - what this task applies, and the daemon's own origins"
  - "[code://packages/server/src/http.ts#L34-L107](../../../../packages/server/src/http.ts#L34-L107) - `ApiOrigins`, `foreign` and `apiHandler`, where every API request enters"
  - "[code://packages/server/src/commands/run.ts#L48-L71](../../../../packages/server/src/commands/run.ts#L48-L71) - `apiOrigins`, the names and the resource host"
  - "[code://packages/server/src/commands/run.ts#L225-L231](../../../../packages/server/src/commands/run.ts#L225-L231) and [#L477](../../../../packages/server/src/commands/run.ts#L477) - the lazily read bound port"
  - "[code://packages/server/test/server-http.test.ts#L241-L288](../../../../packages/server/test/server-http.test.ts#L241-L288) - the six cases"
---

## Objective

An API request whose `Host` is not one of the daemon's own origins, or whose `Origin` is present and is not one of them, is refused with 403 before it is routed.
A request with a body whose `content-type` is not `application/json` is answered 415, in ahpd's own handler until `@cofold/remote@0.3.1` does it (task 06).

## Files

- `UPDATE: packages/server/src/http.ts:34-107` - `ApiOrigins`, `foreign` and `apiHandler`; the check runs before `serve()`, the manifest included.
- `UPDATE: packages/server/src/commands/run.ts:48-71, 225-231, 477` - `apiOrigins` builds the names, and `apiBoundPort` is read per request because it is known only after both listeners are bound.
- `UPDATE: packages/server/test/server-http.test.ts:241-288` - the cases below.

## Steps

1. The check and its 403 sentence in `http.ts`, applied to every path under `/api` (decision `the-http-api-checks-origin-and-host-and-takes-only-json`).
2. The 415 for a non-JSON body in the same place; `serve()` does it now, so ahpd's own check is the Origin and Host one.

## Validation

- `packages/server/test/server-http.test.ts`: with the deployment token, `Origin: https://evil.example` answers 403; today 200.
- With the deployment token, `Host: evil.example:<port>` (the DNS-rebinding shape) answers 403; today 200.
- With the deployment token, a `POST /api/user/add/x` with `content-type: application/x-www-form-urlencoded` answers 415; today it runs.
- No `Origin` and `Host: 127.0.0.1:<port>` or `localhost:<port>` answers 200, and `--remote` still works.
- With `resource: https://ahpd.example.com/`, `Host: ahpd.example.com` answers 200.

## Resume

Done.
`apiHandler` refuses a `Host` or an `Origin` that is not one of the daemon's names, with 403, before `serve()` sees the request; the check is on every `/api` path, the manifest included.
`apiOrigins` in `run.ts` is the loopback names at the API's bound port, the bound address when it is specific (a wildcard adds nothing), and the host the `resource` names, with its origin.
The port is read per request through `apiBoundPort`, which is set once the API's own listener and the daemon's are both bound.
The 415 is `serve()`'s now (task 06), so no second check was added.
`pnpm typecheck` green; `packages/server/test/server-http.test.ts` green, 24 cases.
