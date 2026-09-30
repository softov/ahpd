---
title: A cofold write opens the file, checks the descriptor is the file the check allowed, and writes through it
status: accepted
date: 2026-09-30
refs:
  - file:///github/cofold/packages/tools/src/files.ts - `write_file` and `edit_file`
  - file:///github/cofold/packages/tools/src/paths.ts - `resolveWithin`
  - https://nodejs.org/api/fs.html#filehandlestatoptions - `FileHandle.stat`
---

## Context

cofold's file tools check a real path, then write the lexical path with `writeFile`, which follows every link at the moment of the write; a link swapped in between sends the write outside.

## Decision

`write_file` and `edit_file` open the file, compare the descriptor's device and inode with the `stat` of the real path the check allowed, refuse on a mismatch, and write through the descriptor.

Source: Softov, 2026-09-30, asked how cofold's file tools make sure the file written is the one checked: "Re-check after open" and "Refuse a stale write".

## Consequences

A swap between the check and the open is caught; one after the open writes to the file already checked.

## Options

- **`O_NOFOLLOW`**: refuses a link at the last name only, and Node's `fs` has no `openat` to walk the rest.
