---
title: ahp-git is minted with an authority and read in any client's form
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L85-L86](../../../../packages/sdk/src/changes.ts#L85-L86) - `beforeUri`"
  - "[code://packages/sdk/src/changes.ts#L759-L779](../../../../packages/sdk/src/changes.ts#L759-L779) - `read`"
  - "[code://packages/sdk/src/changes.ts#L425](../../../../packages/sdk/src/changes.ts#L425) - where a modified file's `before` is minted"
---

## Objective

A modified file's `before` resolves from `ahp-git://head/<path>`, from the one-slash form VS Code sends, from its percent-encoded form, and from the `ahp-git:///<path>` form minted before, per decision [an-ahp-edit-uri-carries-its-session-as-base64url](../../../decisions/an-ahp-edit-uri-carries-its-session-as-base64url.md).

## Files

- `UPDATE: packages/sdk/src/changes.ts:85-86` - `beforeUri` mints `ahp-git://head` and percent-encodes each path segment.
- `UPDATE: packages/sdk/src/changes.ts:759-779` - the `ahp-git:` half of `read` parses the URI.
- `CREATE: packages/sdk/test/changes-uris.test.ts` - the cases below.

## Steps

1. `beforeUri(dir, path)` is `ahp-git://head` followed by the absolute file path with each segment percent-encoded.
2. In `read`, parse an `ahp-git:` URI with `new URL`, take its pathname and decode it; with an authority of `head` or none, that is the absolute path.
   Match the longest known directory against it as today.
3. A fragment or a query on the parsed URL is part of the file name as the client split it: rejoin them before matching, so a file named with a `#` still resolves.

## Validation

- `changes-uris.test.ts`, with a git repository in a temporary directory holding a committed `docs/a file #1.md` and `docs/AHP.md`, both modified: `read` answers the committed text for `ahp-git://head/...` as minted, for `ahp-git:/<dir>/docs/AHP.md`, for `ahp-git:///<dir>/docs/AHP.md`, and for `ahp-git:/<dir>/docs/a%20file%20#1.md`.
  Today the one-slash form answers `undefined`.
- The minted `before` of a modified row starts with `ahp-git://head/`.
- `node_modules/.bin/vitest run packages/sdk/test/changes-uris.test.ts` green.

## Resume
