---
title: The file session store reads and writes the row
status: todo
depends: [task-01-one-json-file-reader-and-one-atomic-writer.md, task-05-the-memory-session-store-keeps-one-row-per-session.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions.ts#L194-L220](../../../../packages/sdk/src/sessions.ts#L194-L220) - `rowOf`"
  - "[code://packages/sdk/src/sessions.ts#L222-L256](../../../../packages/sdk/src/sessions.ts#L222-L256) - `save` and `later`"
  - "[code://packages/sdk/src/sessions.ts#L257-L329](../../../../packages/sdk/src/sessions.ts#L257-L329) - `load`"
  - "[code://packages/sdk/src/sessions.ts#L333-L352](../../../../packages/sdk/src/sessions.ts#L333-L352) - the wrapped setters"
  - "[code://packages/sdk/src/sessions.ts#L407-L442](../../../../packages/sdk/src/sessions.ts#L407-L442) - `migrateSessions`, which reads and writes the same rows"
  - "[code://packages/server/test/sessions-migrate.test.ts](../../../../packages/server/test/sessions-migrate.test.ts) - the migration's cases"
---

## Objective

`fileSessions` writes a session's row as `memorySessions` holds it, wraps its setters once, and reads and writes through the shared helper; the files on disk are byte for byte what they are today.

## Files

- `UPDATE: packages/sdk/src/sessions.ts:194-220` - `rowOf` reads the inner row through a `rowOf(id)` that `memorySessions` adds to `Held`, with `version` and `id` put first so key order on disk does not move.
- `UPDATE: packages/sdk/src/sessions.ts:222-256` - `save` writes with `writeJsonAtomic(file, row, { dirMode: 0o700 })`; `later` and its next-tick timer stay as they are.
- `UPDATE: packages/sdk/src/sessions.ts:257-329` - each file read with `readJson`; the field-by-field checks stay, each now setting the inner row.
- `UPDATE: packages/sdk/src/sessions.ts:333-352` - the eleven setters built by one `touched(id, run)` wrapper.
- `UPDATE: packages/sdk/src/sessions.ts:407-442` - `migrateSessions` reads with `readJson` and writes each row with `writeJsonAtomic`.

## Steps

1. Keep every message `told` and `said` say today.
2. A file whose row is empty after the checks is a session with nothing to restore, as today.

## Validation

- A pure refactor: `sessions.test.ts`, `sessions-migrate.test.ts` and every host test that restarts a store stay green unchanged.
- A new case: a row written by the version before this plan (a fixture string with all nine fields) loads, and saving it unchanged writes the same bytes.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume
