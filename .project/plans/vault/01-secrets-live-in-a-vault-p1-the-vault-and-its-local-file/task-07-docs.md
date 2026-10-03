---
title: Docs
status: todo
depends: [task-04-a-plugin-option-names-a-secret.md, task-05-ahpd-vault-sets-deletes-and-lists.md, task-06-a-reference-is-shown-as-written.md, task-08-the-daemon-holds-its-vault.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - `## Commands`, `## Configuration`, `## An HTTP API`"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - `### Marking a credential`, `## What you can register`, `### Writing a usage record`"
---

## Objective

A person can set up the vault and name a secret from `docs/DAEMON.md`, and a plugin author knows how a reference reaches them and how to read one at use time from `docs/PLUGINS.md`.

## Files

- `UPDATE: docs/DAEMON.md` - a `## The vault` section after `## Configuration`: `vault.json` (plain JSON, mode 0600, not encrypted, so it is kept like any file holding a credential), the three scopes and who may write each, `{ "$secret": "host:<name>" }` in a plugin option, `fromEnv` still there for Claude; `ahpd vault set|delete|list` under `## Commands` and their `/api/vault/...` routes and grants under the HTTP API.
- `UPDATE: docs/PLUGINS.md` - under `### Marking a credential`: a reference arrives as the value, `writeOnly` still masks plain text, a reference is shown as written, and `"secretAtUse": true` on an option keeps one for the plugin to read later; a `### Reading a secret` section beside `### Writing a usage record` for `host.secret(name, work)`; `registerVault` in `## What you can register`.

## Steps

1. One sentence per line, no em dash, no hard wrap; match each file's existing headings.

## Validation

- Every command and route in the docs is one `vault-command.test.ts` runs.

## Resume
