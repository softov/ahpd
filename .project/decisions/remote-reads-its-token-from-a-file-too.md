---
title: "`--remote` reads its token from a file too, with --token-file"
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/main.ts#L33-L36](../../packages/server/src/main.ts#L33-L36) - `--token` and `AHPD_TOKEN`, the two sources today"
  - "[code://packages/server/src/commands/options.ts#L357-L380](../../packages/server/src/commands/options.ts#L357-L380) - `secret`, the daemon's own `--connection-token` and `--connection-token-file`, refused together and refused empty"
---

## Context

`--token <secret>` puts the credential in `ps` output and shell history, and `AHPD_TOKEN` is the only other source.
The daemon already takes its own secret either on the line or from a file.

## Decision

`--remote` takes `--token-file <path>`, whose trimmed contents are the token; `--token` and `AHPD_TOKEN` stay.
As with the daemon's `--connection-token` and `--connection-token-file`, passing `--token` and `--token-file` together is refused, and a missing or empty file is refused; `AHPD_TOKEN` is read only when neither flag is given.

Source: Softov, 2026-09-26, asked "Should `--remote` take a `--token-file`, since `--token` shows in `ps` and shell history and `AHPD_TOKEN` is the only alternative?": "Add --token-file".

## Consequences

A script or a service unit can keep the credential in an owner-only file, the way the daemon's own is kept.
Unlike the daemon's `--connection-token-file`, a missing file is not written with a fresh secret, because the client cannot mint one the daemon knows.

## Options

- **`--token` and `AHPD_TOKEN` only.** The environment is inherited by every child and readable in `/proc` by the same user; a file can be narrower.
