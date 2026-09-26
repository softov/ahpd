---
title: The HTTP API checks Origin and Host, and takes only JSON bodies
status: accepted
date: 2026-09-26
refs:
  - "file:///github/cofold/packages/remote/src/serve.ts - `readBody`, which accepts form-encoded bodies and parses anything else as JSON"
  - "[code://packages/server/src/http.ts#L53-L62](../../packages/server/src/http.ts#L53-L62) - `apiHandler`, where every API request enters"
  - "[code://packages/server/src/commands/run.ts#L86-L93](../../packages/server/src/commands/run.ts#L86-L93) - `advertisedResource`, the public identifier a deployment behind a proxy names"
---

## Context

`serve()` accepts `application/x-www-form-urlencoded` bodies and parses a `text/plain` one as JSON, which are both requests a browser sends cross-site without a preflight.
Nothing checks the `Host` header, so a page that rebinds its own name to `127.0.0.1` reads the API's answers as same-origin.

## Decision

A request whose `Origin` is present and is not one of the daemon's own origins is refused with 403, and so is a request whose `Host` is not one of them.
A request with a body is served only when its `content-type` is `application/json`, and anything else is answered 415.

Source: Softov, 2026-09-26, asked "Should the API check Origin and Host (a CSRF and DNS-rebinding guard), and should it accept form bodies at all?": "Yes: check Origin and Host (CSRF and DNS-rebinding guard), and accept JSON bodies only".

## Consequences

A browser can no longer drive the API from another site, with or without a credential.
curl and `--remote` send no `Origin` and keep working.
The daemon's own origins are the loopback names `127.0.0.1`, `localhost` and `[::1]` at the port the API is bound to, the bound host at that port when it is a specific address, and the host of `resource` when one is configured (Softov confirmed, 2026-09-26); a deployment reached through another name sets `resource` to it.
JSON-only is `serve()`'s behaviour for every cofold program, not only ahpd's.

## Options

- **No check, relying on the Bearer token.** Correct only while every host has a token, and a browser still gets to try.
- **Accept form bodies with a CSRF token.** A second secret for an API no browser is meant to call.
