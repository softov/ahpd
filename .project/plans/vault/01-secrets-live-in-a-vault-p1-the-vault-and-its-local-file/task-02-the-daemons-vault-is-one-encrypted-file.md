---
title: The daemon's vault is one file
status: todo
depends: [task-01-the-vault-port-and-the-scope-rule.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts#L274](../../../../packages/server/src/config.ts#L274) - `policiesPath`, a file beside the configuration"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts) - write to a temporary file and rename, the pattern every store here uses"
---

## Objective

`fileVault({ file })` is a `Vault` over one plain JSON file, `vault.json`, read on every call and written whole by temporary file and rename at mode 0600.
It is not encrypted; that is [an idea](../../../ideas/the-local-vault-is-encrypted.md).

## Files

- `UPDATE: packages/server/src/config.ts` - `vaultPath()`, `join(configDir(), 'vault.json')`, beside `policiesPath`.
- `CREATE: packages/server/src/vault.ts` - `fileVault`, answering a `Vault`.
- `CREATE: packages/server/test/vault-file.test.ts` - the cases below.

## Steps

1. The file is JSON: `{ "version": 1, "secrets": { "<name>": "<value>" } }`; no file is an empty vault, and nothing is written until the first `set`.
2. Every call reads the file again, so a write from another process (the terminal's `ahpd vault set` while a daemon runs) is seen at the next call.
3. A file that is not JSON, or not that shape, makes every call throw `<file> is not a vault: <why>`; it is never overwritten.
4. `set` and `delete` check the name with `scopeOf`, then write the whole map to a temporary file beside it, created at mode 0600, and rename it over `vault.json`.
5. `list` answers the names, sorted; `get` answers `undefined` for a name not held; `delete` answers whether it was there.
6. Comments say what each declaration is, and the file's comment names decision `the-local-vault-is-a-plain-file-until-it-is-encrypted`.

## Validation

- `packages/server/test/vault-file.test.ts`: set, then a second `fileVault` over the same file gets it; no file is empty and `get` answers `undefined`; the mode after a set is 0600; delete answers whether it was there; a malformed name is refused at `set`; a file that is not a vault throws and is left as it was.
- `pnpm -F @ahpd/server test`.

## Resume
