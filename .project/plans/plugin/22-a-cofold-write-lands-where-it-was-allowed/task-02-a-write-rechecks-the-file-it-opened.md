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

- `UPDATE: /github/cofold/packages/tools/src/files.ts` - in `write_file` and `edit_file`'s `execute`: `resolveWithin` again, open, `FileHandle.stat` compared with `stat` of the real path, write through the handle.
- `UPDATE:` cofold's tools tests.

## Steps

1. Tests first: a link swapped to point outside between the check and the open is refused and nothing is written outside; an ordinary write and edit still work; a new file is created inside.
2. In `execute`, call `resolveWithin(workspace, path)` again rather than reusing the permission check's answer, and take its real path.
3. An existing file: open it (`r+`), compare the handle's `stat()` device and inode with `stat(realpath)`, refuse on a mismatch, then truncate and write through the handle.
4. A file that does not exist: open it with `wx`, so a link or file created in between makes the open fail rather than be followed.
5. `edit_file` reads the old text through the same handle it writes through, not a separate `readFile`.
6. Follow cofold's own conventions and gates.

## Validation

- The new cases fail first and pass after.
- cofold's typecheck and full test suite.

## Resume
