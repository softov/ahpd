---
title: A stale write is refused
status: todo
depends: [task-01-the-approach-is-chosen.md]
layer: "cofold tools"
refs:
  - file:///github/cofold/packages/tools/src/files.ts - `read_file`, `write_file` and `edit_file`
---

## Objective

In `/github/cofold`, `read_file` records `mtime` and size per session; a write or edit to an existing file never read, or changed since, is refused with a sentence to read it first; the tool's own write updates the record.

## Files

- `UPDATE: /github/cofold/packages/tools/src/files.ts` - the record and the check.
- `UPDATE:` cofold's tools tests.

## Steps

1. Tests first: read then write passes; write without a read is refused; read, change from outside, write is refused; write then write again passes; a new file needs no read.
2. Implement.

## Validation

- The new cases fail first and pass after.
- cofold's typecheck and full test suite.

## Resume
