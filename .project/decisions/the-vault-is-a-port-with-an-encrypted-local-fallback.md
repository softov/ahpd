---
title: Secrets live in a vault port, and the host's own vault is an encrypted file unlocked at start
status: superseded
superseded-by: decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/plugin.ts](../../packages/sdk/src/types/plugin.ts) - `PortKey` and the `register*` calls a plugin replaces a port with"
  - "[code://packages/server/src/rootconfig.ts](../../packages/server/src/rootconfig.ts) - a `writeOnly` option answered `<set>`, still kept in clear in `config.json`"
---

## Context

A credential is plain text in `config.json` today: daemon/11 never sends it to a client, but the file still holds it, so it cannot be shared, copied into a machine or committed.
Repositories and machines on other boxes need per-person and per-team tokens that have nowhere to live.

## Decision

The vault is a port, `vault` in `PortKey`, and a plugin replaces it with `registerVault(vault, 'replace')`, as `usage` is replaced.
The host ships a local vault, used when no plugin registers one and the reference a plugin vault mirrors: one file in the configuration directory, encrypted with a key the daemon is given at start, from an environment variable or a passphrase asked at a terminal.
Until it is unlocked, the vault is locked: a secret resolves to nothing and whatever names one says the vault is locked.
Source: Softov, 2026-10-02: "the valt will be another registration on plugin wire. internally implemented as fallback and reference for the plugin registration."; asked "How does the local vault protect what it holds?": "Encrypted, unlocked at start".

## Consequences

A copied or committed `config.json` carries no key.
A daemon started unattended needs the key in its environment; a person starting it at a terminal is asked.
A sqlite, postgresql or secret-manager plugin takes the vault over later.

## Options

- A plain file with mode 0600: no unlock step, but the secret is readable by anything that reads the file.
- The operating system's keychain: absent on a headless server, which is where the daemon runs.
