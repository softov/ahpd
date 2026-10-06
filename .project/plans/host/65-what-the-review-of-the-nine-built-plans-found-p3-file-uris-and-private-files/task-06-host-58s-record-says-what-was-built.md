---
title: host/58's record says what was built
status: todo
depends: [task-02-the-sdk-builds-every-file-uri-with-uri-of.md, task-03-the-agents-build-every-file-uri-with-uri-of.md]
layer: "docs"
refs:
  - "[code://.project/plans/host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md#L15](../../../../.project/plans/host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md#L15) - \"every one it writes is encoded\""
  - "[code://.project/plans/host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md#L33](../../../../.project/plans/host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md#L33) - \"two writers at once leave the file whole\""
  - "[code://packages/sdk/test/users.test.ts#L536-L547](../../../../packages/sdk/test/users.test.ts#L536-L547) - the case it describes"
---

## Objective

host/58's `implemented.md` says what its build did, and points at host/65 p3 for the rest.

## Files

- `UPDATE: .project/plans/host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md:15` - today it says every `file:` URI the host writes is encoded, while the builders task 02 and task 03 replace were left; it says the host's readers decode and that the writers are host/65 p3's.
- `UPDATE: .project/plans/host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md:20,33` - today it says the test shows two writers at once leave the file whole, and the case only shows a write lands when the old shared temp name is a directory; it says that.

## Steps

1. Correct the two sentences in place; no other line of host/58 changes, and no task status.

## Validation

- `rg -n "two writers at once|every one it writes is encoded" .project/plans/host/58-*` finds nothing.

## Resume
