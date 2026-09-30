---
title: A write re-checks the file it opened
status: todo
depends: [task-01-the-approach-is-chosen.md]
layer: "cofold tools"
refs:
  - file:///github/cofold/packages/tools/src/files.ts - `write_file` and `edit_file`
  - file:///github/cofold/packages/tools/src/paths.ts - `resolveWithin`
---

## Objective

In `/github/cofold`, `write_file` and `edit_file` write through a descriptor whose device and inode match the real path the check allowed, and refuse otherwise.

## Files

- `UPDATE: /github/cofold/packages/tools/src/files.ts` - open, `FileHandle.stat`, compare, write through the handle.
- `UPDATE:` cofold's tools tests.

## Steps

1. Tests first: a link swapped to point outside between the check and the open is refused and nothing is written outside; an ordinary write and edit still work; a new file is created inside.
2. Implement, following cofold's own conventions and gates.

## Validation

- The new cases fail first and pass after.
- cofold's typecheck and full test suite.

## Resume
