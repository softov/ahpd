---
title: The API's guards have no gaps - a missing Host, an IPv6 bind, an empty http.host, no actor, an uppercase scheme
status: done
depends: [task-11-origin-and-host-are-checked.md, task-12-http-host.md, task-13-remote-needs-a-token-and-proves-it-is-remote.md]
layer: "server"
refs:
  - "[code://packages/server/src/http.ts#L72-L79](../../../../packages/server/src/http.ts#L72-L79) - `foreign`, which refuses a request with no `Host` as it refuses a foreign one"
  - "[code://packages/server/src/commands/run.ts#L60-L71](../../../../packages/server/src/commands/run.ts#L60-L71) - `apiOrigins`, which brackets an IPv6 host in the authorities and origins"
  - "[code://packages/server/src/commands/options.ts#L297-L305](../../../../packages/server/src/commands/options.ts#L297-L305) - `http.host`, refused unless it is a non-empty string and a port is named"
  - "[code://packages/server/src/commands/scopes.ts#L34-L45](../../../../packages/server/src/commands/scopes.ts#L34-L45) - `checkScopes`, which answers 401 when a request has no actor"
  - "[code://packages/server/src/main.ts#L112-L115](../../../../packages/server/src/main.ts#L112-L115) - `warnCleartext`, which compares the scheme without regard to case"
---

## Objective

A request with no `Host` is refused like a foreign one; a daemon bound to an IPv6 address answers to `[addr]:port`; `"http": {"host": ""}` is refused at start; a served command with no actor is refused 401; and `--remote HTTP://...` to a host off the machine warns like `http://`.

## Files

- `UPDATE: packages/server/src/http.ts:72-79` - no `Host` is refused.
- `UPDATE: packages/server/src/commands/run.ts:60-71` - an IPv6 host is bracketed in the authorities and origins.
- `UPDATE: packages/server/src/commands/options.ts:297-305` - an empty `http.host` is refused.
- `UPDATE: packages/server/src/commands/scopes.ts:34-45` - no actor off the `cli` surface throws 401.
- `UPDATE: packages/server/src/main.ts:112-115` - the scheme compared without case.
- `UPDATE: packages/server/test/server-http.test.ts`, `packages/server/test/server-commands.test.ts`, `packages/server/test/server-cli.test.ts` - the cases below.

## Steps

1. `foreign`: a request with no `Host` header answers 403 with a sentence saying the API answers only to its own names, the same as a foreign one; decision [the-http-api-checks-origin-and-host-and-takes-only-json](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) says a request is answered only when its Host is one of the daemon's own.
2. `apiOrigins`: a host containing `:` is written `[host]` in both lists (`net.isIPv6`).
3. `http.host`: an empty or whitespace-only string stops with `http.host must name an address, not ""`; the `--host` flag the same, if it reaches the same check.
4. `checkScopes`: when the surface is not `cli` and there is no actor, throw `HttpError(401, ...)` with the sentence `authorizeOverHttp` gives for a missing credential.
5. `warnCleartext`: compare the scheme with `new URL(url).protocol === 'http:'`, or a case-insensitive test.

## Validation

- `server-http.test.ts`: a raw HTTP/1.0 `GET /api/status` with the deployment token and no `Host` answers 403, and the daemon keeps answering. Today it answers 200.
- `server-http.test.ts` (skipped when the machine has no IPv6 loopback): a daemon with `http: { port: 0, host: '::1' }` answers a request with `Host: [::1]:<port>`; and a unit case on `apiOrigins('2001:db8::5', undefined, 9187)` gives `[2001:db8::5]:9187` and `http://[2001:db8::5]:9187`. Today the unit case gives the unbracketed form.
- `server-cli.test.ts`: a configuration with `"http": {"port": 0, "host": ""}` exits 2 with the sentence and binds nothing.
- `server-commands.test.ts`: `checkScopes` on the `remote` surface with no actor throws a 401; today it returns.
- `server-cli.test.ts` or a unit case: `--remote HTTP://10.0.0.5:9187` writes the cleartext warning to stderr.
- `node_modules/.bin/vitest run packages/server/test` green.

## Resume

Seen to fail first: a raw `GET /api/status HTTP/1.0` with the deployment token and no `Host` answered 200 where it wanted 403; the unit case on `apiOrigins('2001:db8::5', undefined, 9187)` failed with `apiOrigins is not a function`; `checkScopes` on the `remote` surface with no actor returned instead of throwing; `{"http": {"port": 0, "host": ""}}` let the daemon fail on its own with exit 1 where the case wanted 2; and `--remote HTTP://127.0.0.2:9` wrote no warning. All six cases pass after the change, and the IPv6 bind case ran here rather than being skipped.

Done: `foreign` refuses a request with no `Host` as it refuses a foreign one; `apiOrigins` brackets an IPv6 bind, so the authority and the origin are ones a URL parser reads back; `httpOf` refuses an `http.host` that is empty or only whitespace; `checkScopes` answers 401 with the sentence the door gives, held once as `SIGN_IN` in `authorize.ts` and read by both; `warnCleartext` reads the scheme without regard to case.

Two departures: `apiOrigins` is exported for the unit case this task asks for, which its Files did not name; and the `--host` flag is left alone, because it is the daemon's own bind host and does not reach `httpOf`, which is the check step 3 made the refusal conditional on.

The cleartext case uses `HTTP://127.0.0.2:9` rather than the `10.0.0.5` this task names: both are outside `ON_MACHINE`, and the address used here refuses the connection at once where an unroutable one costs the fetch timeout.
