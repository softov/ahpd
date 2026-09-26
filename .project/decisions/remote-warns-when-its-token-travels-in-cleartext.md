---
title: "`--remote` to plain http on a host that is not loopback sends the token, with a warning"
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/registry.ts#L155-L181](../../packages/server/src/commands/registry.ts#L155-L181) - `remoteRegistry`, which sends the Bearer token to any URL it is given"
  - "[code://packages/sdk/src/issuers.ts#L113-L115](../../packages/sdk/src/issuers.ts#L113-L115) - `loopbackUrl`, what this repository counts as loopback"
  - "[code://.project/decisions/an-issuer-may-be-plain-http-on-loopback.md](an-issuer-may-be-plain-http-on-loopback.md) - the same line drawn for an issuer"
---

## Context

`ahpd --remote http://<host>` sends `Authorization: Bearer <token>` over plain HTTP, and nothing says so.
On loopback the token never crosses a network; on any other host it does, readable by anything on the path.

## Decision

`--remote` with an `http://` URL whose host is not loopback (`127.0.0.1`, `[::1]` or `localhost`) sends the request, and first writes a warning on stderr that the token travels in cleartext.
An `https://` URL, or `http://` on loopback, warns nothing.

Source: Softov, 2026-09-26, asked "`--remote` to a plain `http://` URL on a host that is not loopback sends the token in cleartext: refuse it, warn, or allow it?": "Warn".

## Consequences

A daemon on a trusted network or behind a tunnel that terminates TLS elsewhere is still reachable without a flag.
The person is told every time, on stderr, so stdout and `--json` stay clean.

## Options

- **Refuse.** Safe, and blocks a LAN or a local tunnel endpoint that has no TLS.
- **Allow silently.** The token leaks and nobody is told.
