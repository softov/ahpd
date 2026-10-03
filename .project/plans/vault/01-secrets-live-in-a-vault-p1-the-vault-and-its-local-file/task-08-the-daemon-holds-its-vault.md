---
title: The daemon holds its vault
status: todo
depends: [task-02-the-daemons-vault-is-one-encrypted-file.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L236-L242](../../../../packages/server/src/commands/run.ts#L236-L242) - the daemon's usage store and `metered`, built before the host"
  - "[code://packages/server/src/commands/run.ts#L279-L295](../../../../packages/server/src/commands/run.ts#L279-L295) - the served facts, with `usage: () => metered`"
  - "[code://packages/server/src/commands/run.ts#L502](../../../../packages/server/src/commands/run.ts#L502) - `usage: store` in the `HostOptions` literal"
  - "[code://packages/server/src/commands/run.ts#L626](../../../../packages/server/src/commands/run.ts#L626) - `metered` replaced by what the fold registered"
  - "[code://packages/server/src/commands/run.ts#L712-L746](../../../../packages/server/src/commands/run.ts#L712-L746) - the startup announcement"
  - "[code://packages/server/src/commands/served.ts#L53-L58](../../../../packages/server/src/commands/served.ts#L53-L58) - `ServedFacts.usage`, read per request"
  - "[code://packages/server/test/usage-port.test.ts](../../../../packages/server/test/usage-port.test.ts) - the daemon's store and a plugin's replacement, run as a process"
---

## Objective

A daemon builds `fileVault` over `vaultPath()` beside its usage store, hands it to the host as `HostOptions.vault` and to the served commands as `ServedFacts.vault`, and says `vault <path>` when it starts.

## Files

- `UPDATE: packages/server/src/commands/run.ts:236-242` - `const vault = fileVault({ file: vaultPath() })` beside the usage store, and a `let held: Vault = vault` that the fold replaces, as `metered` is.
- `UPDATE: packages/server/src/commands/run.ts:279-295` - `vault: () => held` in the served facts, beside `usage`.
- `UPDATE: packages/server/src/commands/run.ts:502` - `vault` in the `HostOptions` literal, beside `usage: store`.
- `UPDATE: packages/server/src/commands/run.ts:626` - `if (folded.vault !== undefined) held = folded.vault;`.
- `UPDATE: packages/server/src/commands/run.ts:712-746` - a line `vault <path>` after the `config` line, or `vault from a plugin` when the fold replaced it.
- `UPDATE: packages/server/src/commands/served.ts:53-58` - `vault?(): Vault`, read per request, beside `usage`.
- `CREATE: packages/server/test/vault-port.test.ts` - the cases below, as a process, the way `usage-port.test.ts` runs one.

## Steps

1. The announcement line is its own line, after the ones `daemon.ts` matches, so their places do not move.
2. Nothing reads `vault.json` at start; the first call reads it, as task 02 says.

## Validation

- `packages/server/test/vault-port.test.ts`: a daemon says `vault <configDir>/vault.json`; a secret set in the file before start is read by a plugin fixture through `host.secret`; with a plugin that registers its own vault with `'replace'`, the line says `vault from a plugin` and the fixture reads from that one.
- `pnpm -F @ahpd/server test`.

## Resume
