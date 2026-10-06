---
title: The daemon's files read and write through them
status: todo
depends: [task-01-one-json-file-reader-and-one-atomic-writer.md]
layer: "server"
refs:
  - "[code://packages/server/src/vault.ts#L31-L60](../../../../packages/server/src/vault.ts#L31-L60) - `readSaved`"
  - "[code://packages/server/src/vault.ts#L102-L107](../../../../packages/server/src/vault.ts#L102-L107) - `writeSaved`"
  - "[code://packages/server/src/daemon.ts#L90-L122](../../../../packages/server/src/daemon.ts#L90-L122) - the record's reads"
  - "[code://packages/server/src/daemon.ts#L393-L402](../../../../packages/server/src/daemon.ts#L393-L402) - `claim`'s write"
  - "[code://packages/server/src/install.ts#L137-L161](../../../../packages/server/src/install.ts#L137-L161) - `readEntry` and `writeEntry`"
  - "[code://packages/server/test/vault-file.test.ts](../../../../packages/server/test/vault-file.test.ts) - the vault file's cases"
---

## Objective

The vault, the daemon record and a configuration entry are read with the shared reader and written with the shared writer; the vault still says only its fixed sentences and an errno code.

## Files

- `UPDATE: packages/server/src/vault.ts:31-60` - `missing` is an empty vault; `unreadable` throws `could not be read as a vault: <code>`; `not-json` throws `is not a vault: it is not JSON`; the secrets and version checks stay.
- `UPDATE: packages/server/src/vault.ts:102-107` - `writeJsonAtomic(file, body)`; `OWNER_ONLY` and its comment stay as the mode passed.
- `UPDATE: packages/server/src/daemon.ts:90-122,393-402` - `recordIn` takes the reader's value; a record that is not one is still deleted; `claim` writes with `writeJsonAtomic`.
- `UPDATE: packages/server/src/install.ts:137-161` - `readEntry` over `readJsonObject` with its two sentences; `writeEntry` over `writeJsonAtomic`.
- `UPDATE: packages/server/test/vault-file.test.ts` - one case.

## Steps

1. In `vault.ts`, never pass the outcome's `error` into a message; the existing comments that say why move onto the new lines.
2. `daemon.ts`'s sweeper and `TEMP` stay as they are.

## Validation

- Written first and seen failing if the parser's text leaks (it passes today and must still pass): a vault file holding `{"secrets": {"a": "hunter2"` refuses with a message that does not contain `hunter2`.
- A pure refactor otherwise: `vault-file.test.ts`, `vault-port.test.ts`, `vault-command.test.ts`, `daemon.test.ts`, `plugin-install.test.ts` stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm test packages/server`.

## Resume
