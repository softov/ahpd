---
title: A stale write is refused
status: done
depends: [task-01-the-approach-is-chosen.md]
layer: "cofold tools"
refs:
  - file:///github/cofold/packages/tools/src/files.ts - `read_file`, `write_file` and `edit_file`
  - file:///github/cofold/packages/agents/src/run/turn.ts - `capArgs`, rebuilt each run, carrying `sessionId` and `kv`
---

## Objective

In `/github/cofold`, `read_file` records `mtime` and size per session; a write or edit to an existing file never read, or changed since, is refused with a sentence to read it first; the tool's own write updates the record.

## Files

- `UPDATE: /github/cofold/packages/tools/src/files.ts` - the record, a module-level map keyed by `capArgs.sessionId`, and the check.
- `UPDATE:` cofold's tools tests.

## Steps

1. Keep the record in a module-level map in `@cofold/tools`, keyed by `capArgs.sessionId` because the tools closure lasts one run; it lasts the process.
   After a restart the map is empty, so a write to an existing file is refused until the session reads it again.
2. Tests first: read then write passes; write without a read is refused; read, change from outside, write is refused; write then write again passes; a new file needs no read; a read in one run and a write in the next run of the same session passes; with the map emptied, as after a restart, a write to a file read before is refused until it is read again.
3. Implement.

## Validation

- The new cases fail first and pass after.
- cofold's typecheck and full test suite.

## Resume
