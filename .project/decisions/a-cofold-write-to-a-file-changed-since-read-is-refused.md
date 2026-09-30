---
title: A cofold write to a file that changed since the session read it, or that it never read, is refused
status: accepted
date: 2026-09-30
refs:
  - file:///github/cofold/packages/tools/src/files.ts - `read_file`, `write_file` and `edit_file`
---

## Context

`write_file` replaces a file whether or not the session read it, so a change another process or a person made since is overwritten without the model seeing it.

## Decision

`read_file` records each file's `mtime` and size per session.
`write_file` and `edit_file` on an existing file refuse when the session never read it or its `mtime` or size changed since, with a sentence saying to read it first; a new file is written.

Source: Softov, 2026-09-30, asked how cofold's file tools make sure the file written is the one checked: "Re-check after open" and "Refuse a stale write".

## Consequences

A model that writes blind is sent to read first, one extra call.
A write the session made itself updates the record, so it can write again.

## Options

- **Only the re-check after open**: a change made since the read is still overwritten.
