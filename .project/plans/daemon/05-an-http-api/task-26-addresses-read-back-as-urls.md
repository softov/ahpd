---
title: The addresses the daemon prints and accepts read back as URLs - IPv6 in brackets, a resource with its port
status: done
depends: [task-18-the-guards-have-no-gaps.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L64-L75](../../../../packages/server/src/commands/run.ts#L64-L75) - `apiOrigins`, which adds a resource's hostname but not its host with its port"
  - "[code://packages/server/src/commands/run.ts#L209-L217](../../../../packages/server/src/commands/run.ts#L209-L217) - the served facts' `url`, unbracketed"
  - "[code://packages/server/src/commands/run.ts#L519-L525](../../../../packages/server/src/commands/run.ts#L519-L525) - the `http on` line, unbracketed"
---

## Objective

With `http.host: "::1"` the daemon prints `http://[::1]:N/api`, which `--remote` takes as written; the served `status` names a URL a parser reads; and a `resource` with an explicit port (`https://ahpd.example.com:8443/`) answers a request whose `Host` keeps that port.

## Files

- `UPDATE: packages/server/src/commands/run.ts:64-75,209-217,519-525` - the brackets and the resource's host.
- `UPDATE: packages/server/test/server-http.test.ts` - the cases below.

## Steps

1. One helper writes a host for a URL, bracketing an IPv6 address; the `http on` line and the served facts' `url` use it. The `ahpd on ws://` line is read by `daemon.ts` with a regular expression: check that reader before changing the line, and change both together or leave that line alone and say so in the Resume.
2. `apiOrigins` adds `at.host` (hostname with the resource's port) beside what it adds now.
3. The live IPv6 case asserts the `http on` line is `http://[::1]:<port>/api`, which fails without the brackets, since `[::1]` is always among the loopback names.

## Validation

- `server-http.test.ts` (skipped without IPv6 loopback): the `http on` line is `http://[::1]:<port>/api`, and a `--remote` run against that URL answers `status`.
- A unit case: `apiOrigins('127.0.0.1', 'https://ahpd.example.com:8443/', 9187).authorities` contains `ahpd.example.com:8443`. Today it does not.
- `node_modules/.bin/vitest run packages/server/test` green.

## Resume

Implemented 2026-09-27. Tests first, each seen to fail: the IPv6 case read `::1` off the `http on` line where it now wants `[::1]`, and `apiOrigins('127.0.0.1', 'https://ahpd.example.com:8443/', 9187).authorities` lacked `ahpd.example.com:8443`. This machine has an IPv6 loopback, so the IPv6 case ran rather than skipped.

`run.ts` has `urlHost`, which brackets an IPv6 address; `apiOrigins`, the `http on` line and the served facts' `url` use it. The `ahpd on ws://` line uses it too: its reader, `recordOf` in `daemon.ts`, takes `ws://[^\s,]+`, which keeps the brackets, and `readyUrl` only appends a slash and the token, so the record's `url` becomes one a parser reads and nothing else changes. `apiOrigins` adds `at.host` when the resource names a port. `docs/DAEMON.md` says both.

Departure: `--remote` is given the origin of the `http on` line, `http://[::1]:N`, not the line's URL with `/api`. `remoteRegistry` appends `/api` to what it is given, `docs/DAEMON.md` says "The URL is the daemon's origin; `/api` is appended", and `registry.ts` is not in this task's Files; the IPv4 line is not taken with `/api` either.

Found, not changed: `personalUrl` in `packages/server/src/config.ts` writes `ws://${host}:${port}` unbracketed, so a served `user token --url` on an IPv6 bind names a URL a parser rejects. It is outside this task's Files.

`node_modules/.bin/vitest run packages/server/test/server-http.test.ts packages/server/test/daemon.test.ts`: 70 passed.
