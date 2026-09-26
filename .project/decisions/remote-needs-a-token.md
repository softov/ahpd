---
title: "`--remote` needs a token"
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/main.ts#L33-L53](../../packages/server/src/main.ts#L33-L53) - `--remote`, `--token` and `AHPD_TOKEN`, read before the program exists"
  - "[code://packages/server/src/commands/registry.ts#L155-L181](../../packages/server/src/commands/registry.ts#L155-L181) - `remoteRegistry`, which sends no header when there is no token"
  - "[code://.project/decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md](an-unconfigured-daemon-does-not-serve-the-http-api.md) - every daemon serving the API requires a credential"
---

## Context

`--remote` runs without a token and sends no `Authorization` header, and every command it runs is then refused with 401 by a daemon that requires one.
Every daemon serving the API requires a credential, so a remote call without one can only fail, one round trip later.

## Decision

`ahpd --remote <url>` with neither `--token` nor `AHPD_TOKEN` is refused before anything is fetched, with exit code 2 and a sentence naming both.

Source: Softov, 2026-09-26, asked "For `--remote` to a non-loopback `http://` URL: refuse it, warn, or allow it? Should there also be a `--token-file` option?": "`--remote`: refuse it when there is no token".

## Consequences

The failure is said locally and at once, rather than as a 401 from the daemon.
Reading the cached manifest for `--help` also needs a token, since the refusal comes first.

## Options

- **Allow it and let the daemon answer 401.** The error is the same, arrives later, and is worded by the far side.
