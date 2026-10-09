---
title: One JSON file reader and one atomic writer
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions.ts#L236-L241](../../../../packages/sdk/src/sessions.ts#L236-L241) - the write to lift"
  - "[code://packages/sdk/src/policies.ts#L273-L291](../../../../packages/sdk/src/policies.ts#L273-L291) - the read's four outcomes"
  - "[code://packages/server/src/vault.ts#L31-L48](../../../../packages/server/src/vault.ts#L31-L48) - a caller that may use only the errno code"
  - "[code://packages/server/src/daemon.ts#L125](../../../../packages/server/src/daemon.ts#L125) - the temp name the sweeper reads"
  - "[code://packages/sdk/src/index.ts](../../../../packages/sdk/src/index.ts) - where the helper is exported"
---

## Objective

`packages/sdk/src/jsonfile.ts` exports `readJson`, `readJsonObject` and `writeJsonAtomic` from `@ahpd/sdk`, and nothing calls them yet.

## Files

- `CREATE: packages/sdk/src/jsonfile.ts` - the three functions and the `JsonRead` type.
- `CREATE: packages/sdk/test/jsonfile.test.ts` - the helper's cases.
- `UPDATE: packages/sdk/src/index.ts` - the exports.

## Steps

1. `readJson(file)`: `{ ok: true, value }`, or `{ ok: false, kind: 'missing' }` for ENOENT, `{ ok: false, kind: 'unreadable', code, error }` for any other read failure, `{ ok: false, kind: 'not-json', error }` for a parse failure.
2. `readJsonObject(file)`: the same, plus `{ ok: false, kind: 'not-object' }` for a value that is not a non-array object.
3. `writeJsonAtomic(file, value, options?)`: `mkdirSync(dirname(file), { recursive: true, ...(dirMode ? { mode: dirMode } : {}) })`, `${file}.${process.pid}.tmp` written as `JSON.stringify(value, null, 2) + '\n'` with `mode` (default `0o600`), then `renameSync`; a failure throws, and the caller says it.
4. The doc comment on `JsonRead` says the outcome carries no sentence on purpose, and names the vault as the caller that must not word the raw error.

## Validation

- `jsonfile.test.ts`, a new helper's cases: each of the five outcomes from a temp file (missing, a directory for unreadable, `nope`, `[]`, `{}`); a write lands `0600` with a trailing newline and leaves no `.tmp` behind; `mode: 0o644` is honoured; the temp name seen while writing (a directory placed at `<file>.<pid>.tmp` makes the write throw) is the pid form.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk/test/jsonfile.test.ts`.

## Resume

Implemented 2026-10-09 in the `build/agents/61968c74` worktree, test-first.

- `packages/sdk/src/jsonfile.ts` exports `JsonRead`, `JsonObjectRead`, `readJson`, `readJsonObject`, `JsonWriteOptions` and `writeJsonAtomic`; `packages/sdk/src/index.ts` exports the three functions and the three types, each on its own line, so host 59's exports land beside them.
- `packages/sdk/test/jsonfile.test.ts`, 15 cases: the five outcomes (a value that is an object and one that is a list, `missing`, a directory as `unreadable` with `EISDIR`, `nope` and an empty file as `not-json`), the object reader refusing `[]`, `null` and three leaves, the write's two-space body with a trailing newline and no scratch behind, `0o600` by default, `0o644` where a caller names it, the folder made first and at a `dirMode`, and the pid form proved by putting a directory at the temp's own name.
- Step 3 does not name the `rmSync` the writer makes before it writes. It is there because `mode` is applied when a file is created and not when one is opened: a temp left at 0644 by an earlier process that held this pid would keep it, and the rename would put that on the file. `is owner-only even when a readable temp at its own name was left behind` pins it.
- Nothing calls the helper yet, as the objective says.
