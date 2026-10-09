---
title: The daemon's files read and write through them
status: done
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

Implemented 2026-10-09 in the `build/agents/61968c74` worktree, test-first.

- `vault.ts` reads with `readJson`: `missing` is `{ version: 1, secrets: {} }`, `unreadable` throws `${file} could not be read as a vault: ${read.code ?? 'the file could not be opened'}`, `not-json` throws `${file} is not a vault: it is not JSON`. The outcome's `error` is never passed into a sentence, on purpose: the parser's message quotes the source it choked on, and in that file the source is a secret. `writeSaved` is `writeJsonAtomic(file, body, { mode: OWNER_ONLY })` with `OWNER_ONLY` and its comment as they were.
- `daemon.ts` reads the record with `readJson` in `running()` and `recorded()` and writes it with `writeJsonAtomic(daemonPath(), record, { mode: 0o600 })` in `claim`, after the sweep. A file that is not there and one that could not be opened are both a daemon with no record, and neither is touched; a file that is not JSON is still one nobody may clear, so it is unlinked as before. `TEMP`, `sweepTemps` and the log rotation's `renameSync` are untouched.
- `install.ts` reads an entry with `readJsonObject`: `missing` is `{}`, `not-object` throws `${path} is not a JSON object.`, anything else throws `${path} could not be read: <message>`. `writeEntry` is `writeJsonAtomic(path, held, { mode: 0o600 })`, so that write is atomic where it wrote in place before, at the mode it had.
- `packages/server/test/vault-file.test.ts` gains `says nothing about the secret a file that is not JSON was in the middle of holding`: a file holding `{"secrets": {"a": "hunter2"` refuses with `${file} is not a vault: it is not JSON`, the refusal does not contain `hunter2`, and the file is left exactly as it was.
- No other test changed. `vault-port.test.ts`, `vault-command.test.ts`, `daemon.test.ts` and `plugin-install.test.ts` stay green as they are.
