---
title: The capture is readable only by its owner
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L352-L355](../../../../packages/server/src/commands/run.ts#L352-L355) - `writeFileSync(at, '')`, which creates the file with the umask"
---

## Objective

Every file of a capture is created `0600`, because it holds each token a client sent in `authenticate`.

## Files

- `UPDATE: packages/server/src/commands/run.ts:352-355` - create the file with mode `0o600`, and set the mode on a file that already exists.
- `UPDATE: test/wire.test.ts` - the mode is asserted.

## Steps

1. Create the capture with `{ mode: 0o600 }` and `chmod` it when it already existed, since a mode on create does not change an existing file.
2. Apply the same when task 02's writer starts a new file after a roll, if task 02 is done first.

## Validation

- `test/wire.test.ts`: on POSIX, the capture's mode is `0600` both when it is new and when it existed with `0644`.
- `pnpm test` green.

## Resume

