---
title: A console call fails a test
status: implemented
depends: [01, 02]
layer: "server tests"
refs:
  - "[code://packages/server/test/no-console.test.ts](../../../../packages/server/test/no-console.test.ts) - the check"
---

## Objective

A test lists every `console` call in a package's `src`, and fails when there is one.

## Files

- `CREATE: packages/server/test/no-console.test.ts`.
- `DELETE: .project/problems/plugin-code-writes-its-warnings-to-the-console.md`.

## Steps

1. Read every `.ts` under each `packages/<name>/src`.
2. List each line that calls `console.log`, `info`, `warn`, `error`, `debug` or `trace`, apart from a comment.
3. Expect the list to be empty.
4. Delete the problem file.

## Validation

- The test passes, and fails on a call planted in the sdk.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
