---
title: Secrets live in a vault, and a plugin option or a machine need names one - implemented
date: 2026-10-03
refs:
  - "[code://packages/sdk/src/vault.ts](../../../../packages/sdk/src/vault.ts)"
  - "[code://packages/server/src/vault.ts](../../../../packages/server/src/vault.ts)"
  - "[code://packages/computer/src/secrets.ts](../../../../packages/computer/src/secrets.ts)"
---

The host has a vault: a port a plugin may replace, filled by the daemon's plain `vault.json`, with names in a `host:`, `team:` or `user:` scope; a plugin option and a machine need may name a secret instead of holding it.

## What was built

- [p1](../01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/implemented.md) - the port, the file, `$secret` in plugin options, `ahpd vault`.
- [p2](../01-secrets-live-in-a-vault-p2-a-machine-need-names-a-secret/implemented.md) - a machine need read from the vault when the machine is made.

## Verified

- Each child's `implemented.md`; the full suite at 2548 tests after p2.

## Departures from the plan

- Each child's `implemented.md`.

## Left for later

- Encryption: [the idea](../../../ideas/the-local-vault-is-encrypted.md).
