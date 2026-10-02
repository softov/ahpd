---
title: A file per session
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/sessions.ts#L109-L207](../../../../packages/sdk/src/sessions.ts#L109-L207) - `fileSessions`"
  - "[code://packages/server/src/config.ts#L185](../../../../packages/server/src/config.ts#L185) - the path"
---

## Objective

`fileSessions` takes a directory, reads every `<id>.json` in it at start, writes only the files of ids changed since the last save (temporary file, rename, mode 0600, directory 0700), removes a file on `forget` and when its row becomes empty; an id is made safe as a file name and read back unchanged.

## Files

- `UPDATE: packages/sdk/src/sessions.ts` - the directory store.
- `UPDATE: packages/server/src/config.ts` - `sessionsDir()` beside the old path, which task 03 still reads.
- `UPDATE:` the sessions store tests.

## Steps

1. Tests first in a temp directory: two sessions give two files; a change to one rewrites only it (mtime of the other unchanged); `forget` removes its file; an emptied row removes its file; an id with `/` or `:` round-trips; a bad file is warned about and skipped, the others load.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
