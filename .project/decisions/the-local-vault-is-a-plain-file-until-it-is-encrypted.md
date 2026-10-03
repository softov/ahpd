---
title: Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted
status: accepted
date: 2026-10-03
supersedes: decisions/the-vault-is-a-port-with-an-encrypted-local-fallback.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts](../../packages/sdk/src/types/plugin.ts) - `PortKey` and the `register*` calls a plugin replaces a port with"
  - "[code://packages/server/src/rootconfig.ts](../../packages/server/src/rootconfig.ts) - a `writeOnly` option answered `<set>`, still kept in clear in `config.json`"
---

## Context

A credential is plain text in `config.json` today, so it cannot be shared, copied into a machine or committed.
The vault was decided encrypted and unlocked at start; asked which cipher and key form, Softov chose to have the vault first and the encryption after.

## Decision

The vault is a port, `vault` in `PortKey`, and a plugin replaces it with `registerVault(vault, 'replace')`, as `usage` is replaced.
The host ships a local vault, used when no plugin registers one and the reference a plugin vault mirrors: one JSON file in the configuration directory, mode 0600, written by temporary file and rename.
It is not encrypted and has no locked state yet; encrypting it, and the key a daemon is started with, is [an idea](../ideas/the-local-vault-is-encrypted.md).
Source: Softov, 2026-10-02: "the valt will be another registration on plugin wire. internally implemented as fallback and reference for the plugin registration."; Softov, 2026-10-03, asked how the key reaches the daemon: "to the valt now. crypt lattter".

## Consequences

`config.json` names secrets and holds none, so it can be shared, copied and committed.
`vault.json` is as readable as `config.json` is today to anything running as the daemon's user; the gain now is that secrets are in one place under one name.
A sqlite, postgresql or secret-manager plugin takes the vault over later.

## Options

- Encrypted now, unlocked at start: the superseded decision; it needs a cipher, a key form and an unlock path decided first.
- The operating system's keychain: absent on a headless server, which is where the daemon runs.
