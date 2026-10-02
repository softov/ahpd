---
title: Secrets live in a vault behind a port, not in the config file
created: 2026-09-29
revalidated: 2026-10-02
---

Raised with daemon/11, which keeps a secret option as plain text in `config.json`, as it is today, and never sends its value to a client.
Needed again by [repositories](repositories-are-resources.md), whose provider tokens (GitHub, GitLab, a person's own) have to be kept somewhere that is not the config file.

## What Softov settled (2026-10-02)

- The vault is a port, `vault` in `PortKey`, and a plugin replaces it with `registerVault(vault, 'replace')`, as `usage` is replaced with `registerUsage`.
- The host ships a local vault: a file store on this machine, used when no plugin registers one. It is the fallback and the reference implementation a plugin vault mirrors.
- A [sqlite](a-sqlite-store.md) or [postgresql](a-postgresql-store.md) plugin, or one for another secret manager, takes it over later, the way the usage store is expected to move to sqlite and then a shared postgres.

Source: Softov, 2026-10-02: "we will need to make a way to store a valt locally initially. until the plugin sqlite and postgresql arrives or another to handle the valt store. the valt will be another registration on plugin wire. internally implemented as fallback and reference for the plugin registration."

## What it would buy

- `config.json` can be shared, copied into a machine or committed without carrying a key; a secret option holds a reference instead, such as `{ "$secret": "agent-cofold.apiKey" }`, resolved when the plugin loads, so the plugin still receives the value.
- A key is changed in one place for every plugin that names it.
- A person's own tokens (a repository provider's, a model provider's) can be kept per person rather than per host.

## Questions it leaves

- The port's shape: get, set and delete by name, and whether a name is scoped (`host:`, `user:<id>`, `plugin:<name>`) so a person's secret is theirs alone.
- How the local vault protects what it holds: a file with tight permissions, encrypted with a key from where, or the operating system's keychain when there is one.
- Whether `{ "fromEnv": "NAME" }` (claude/12) and the proxy's key-by-variable stay beside it as the cheaper route.
- The grant that writes a secret, whether a person may set their own, and what `ahpd plugin config` and a client show for one: only whether it is set.
