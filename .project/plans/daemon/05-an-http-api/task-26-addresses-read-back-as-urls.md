---
title: The addresses the daemon prints and accepts read back as URLs - IPv6 in brackets, a resource with its port
status: todo
depends: [task-18-the-guards-have-no-gaps.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L60-L71](../../../../packages/server/src/commands/run.ts#L60-L71) - `apiOrigins`, which adds a resource's hostname but not its host with its port"
  - "[code://packages/server/src/commands/run.ts#L205-L213](../../../../packages/server/src/commands/run.ts#L205-L213) - the served facts' `url`, unbracketed"
  - "[code://packages/server/src/commands/run.ts#L515-L521](../../../../packages/server/src/commands/run.ts#L515-L521) - the `http on` line, unbracketed"
---

## Objective

With `http.host: "::1"` the daemon prints `http://[::1]:N/api`, which `--remote` takes as written; the served `status` names a URL a parser reads; and a `resource` with an explicit port (`https://ahpd.example.com:8443/`) answers a request whose `Host` keeps that port.

## Files

- `UPDATE: packages/server/src/commands/run.ts:60-71,205-213,515-521` - the brackets and the resource's host.
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
