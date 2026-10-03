---
title: The vault port and the daemon's plain file - implemented
date: 2026-10-03
refs:
  - "[code://packages/sdk/src/vault.ts](../../../../packages/sdk/src/vault.ts)"
  - "[code://packages/sdk/src/types/vault.ts](../../../../packages/sdk/src/types/vault.ts)"
  - "[code://packages/server/src/vault.ts](../../../../packages/server/src/vault.ts)"
  - "[code://packages/server/src/commands/vault.ts](../../../../packages/server/src/commands/vault.ts)"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
---

The host has a `vault` port, filled by the daemon with one plain `vault.json` (mode 0600) in the configuration directory unless a plugin registers a vault with `'replace'`; a plugin option may say `{ "$secret": "host:<name>" }` and the plugin gets the value, and `ahpd vault set|delete|list` manage it without ever answering a value.

## What was built

- [`code://packages/sdk/src/vault.ts`](../../../../packages/sdk/src/vault.ts) - `scopeOf` (the `host:`, `team:<team>/`, `user:<id>/` forms; whitespace and control characters refused), `secretRef`, `readSecret` applying the scope rule.
- [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts) and `types/plugin.ts`, `types/host.ts`, `validate.ts` - `vault` in `PortKey`, `registerVault`, `PluginHost.secret(name, work?)`, `HostOptions.vault`, wired as `usage` is.
- [`code://packages/server/src/vault.ts`](../../../../packages/server/src/vault.ts) - `fileVault({ file })`: re-read on every call, temp file and rename at 0600, only `version: 1` accepted and anything else left untouched, fixed sentences that never quote the file.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `resolveSecrets` resolves `$secret` before the schema check and checks the value; a `secretAtUse` node is left as written; `vaultInForce` follows the fold's owner rule; a vault plugin's own options cannot name a secret.
- [`code://packages/server/src/commands/vault.ts`](../../../../packages/server/src/commands/vault.ts) - `ahpd vault` at the terminal (value from piped stdin only) and served (`POST /api/vault/set|delete/<name>`, `GET /api/vault/list`), with the grants of the plan.
- `commands/run.ts`, `served.ts`, `config.ts` - the daemon builds the file vault beside the usage store and says `vault <path>` or `vault from a plugin` at start.
- `commands/config.ts`, `rootconfig.ts`, `commands/plugin.ts` - a reference is answered as written and checked with `scopeOf` where it is written.
- `docs/DAEMON.md` `## The vault`, `docs/PLUGINS.md` naming and reading a secret.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 171 files and 2542 tests, rerun by the reviewer.
- A review probed the security paths: no value in any HTTP or command answer, problem line, log or error (a broken `vault.json` and a schema refusal included); grants per scope; 0600 and rename; a malformed or later-version file never overwritten; scope parsing not bypassable. Seven defects it found were fixed and retested.

## Departures from the plan

- `mayWrite` and `mayList` take the request context, not a principal, because grants are asked through `bounded(context, grants)`.
- A team membership is compared by parsing it, so a project membership in team `eng` with `team:write` may write `team:eng/...`, the same rule reading follows.
- `vault list` filters to what the caller may see rather than refusing; task 04 was built before task 08, whose test needs the loader wiring.
- A `GET` on the served `set` route answers 404, as every action route there does.

## Left for later

- Encryption and a key at start: [the idea](../../../ideas/the-local-vault-is-encrypted.md).
- A machine need naming a secret: [p2](../01-secrets-live-in-a-vault-p2-a-machine-need-names-a-secret/plan.md).
