---
title: Computer's owner file reads and writes through them
status: done
depends: [task-01-one-json-file-reader-and-one-atomic-writer.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/owners.ts#L117-L138](../../../../packages/computer/src/owners.ts#L117-L138) - `read`"
  - "[code://packages/computer/src/owners.ts#L157-L171](../../../../packages/computer/src/owners.ts#L157-L171) - `write`"
  - "[code://packages/computer/package.json#L58](../../../../packages/computer/package.json#L58) - the peer range host 59 task 05 raises"
---

## Objective

Computer's owner file is read with the shared reader and written with the shared writer, saying what it says today.

## Files

- `UPDATE: packages/computer/src/owners.ts:117-138` - `missing` is `{}`; `unreadable`, `not-json` and `not-object` each `complain(log, 'could not read', ...)` as now.
- `UPDATE: packages/computer/src/owners.ts:157-171` - `writeJsonAtomic(path, held)` inside the same `try`.

## Steps

1. Start only once host 59 task 05 has raised computer's `@ahpd/sdk` peer range to a version that exports `jsonfile.ts`; if host 59 has not landed, raise it here to the same version and say so in this task's Resume.

## Validation

- A pure refactor: `computer-owner.test.ts` and the rest of `packages/computer/test` stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test packages/computer`.

## Resume

Implemented 2026-10-09 in the `build/agents/61968c74` worktree, test-first.

- Step 1: host 59 had not landed in this worktree, so computer's peer range was looked at and left alone. `packages/computer/package.json` already names `"@ahpd/sdk": ">=0.10"` and the sdk that exports `jsonfile.ts` is 0.10.0, so the range already reaches the helper and nothing had to be raised.
- `packages/computer/src/owners.ts` reads with `readJsonObject`: `missing` is `{}`, and any other outcome is one `complain(log, 'could not read', ...)` - `not-object` with `the top of it is not an object of machines`, `unreadable` and `not-json` with the error the reader carried - which leaves `undefined` and keeps a write off that file. `write` is `writeJsonAtomic(path, held, { mode: 0o600 })` inside the same `try`, whose `catch` still makes it `could not write`. The mode is named rather than taken from the default, which is the same `0o600`.
- No test changed: `packages/computer/test` stays green as it is.
