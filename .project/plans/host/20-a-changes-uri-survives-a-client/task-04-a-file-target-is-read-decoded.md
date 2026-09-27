---
title: A file target an operation names is read decoded
status: todo
depends: [task-03-every-minted-uri-round-trips.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L70-L76](../../../../packages/sdk/src/changes.ts#L70-L76) - `pathIn`, which slices `file://` off and does not decode"
---

## Objective

`discard` and `revert` act on a file whose name has a space, a `#` or any other escaped character when the client sends its `file://` URI in VS Code's encoded form, per decision [an-ahp-edit-uri-carries-its-session-as-base64url](../../../decisions/an-ahp-edit-uri-carries-its-session-as-base64url.md), which has `read` parse and decode what a client sends.

## Files

- `UPDATE: packages/sdk/src/changes.ts:70-76` - `pathIn` parses the URI and decodes its path before the directory check.
- `UPDATE: packages/sdk/test/changes-uris.test.ts` - the case below.

## Steps

1. Parse the target with `new URL`, require the `file:` scheme and an empty or `localhost` host, and decode the path with `fileURLToPath`.
2. Check the decoded path against the directory, normalised, so `..` cannot leave it.

## Validation

- `changes-uris.test.ts`: in a scratch repository, `discard` on `file:///<dir>/a%20file%20%231.md` puts `a file #1.md` back as `HEAD` has it.
  Today it fails with git's "pathspec did not match".
- `file:///<dir>/../elsewhere.txt` is refused as outside the directory.
- `node_modules/.bin/vitest run packages/sdk/test/changes-uris.test.ts` green.

## Resume
