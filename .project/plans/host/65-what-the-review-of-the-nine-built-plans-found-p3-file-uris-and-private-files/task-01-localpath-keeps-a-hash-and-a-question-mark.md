---
title: localPath keeps a # and a ?
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/fileuri.ts#L49-L76](../../../../packages/sdk/src/fileuri.ts#L49-L76) - `localPath`, through `fileURLToPath`"
  - "[code://packages/sdk/test/fileuri.test.ts](../../../../packages/sdk/test/fileuri.test.ts) - its cases"
---

## Objective

`localPath` reads a literal `#` or `?` in a `file:` URI as part of the path, and `localPath(uriOf(p))` is `p` for a path holding either.

## Files

- `UPDATE: packages/sdk/src/fileuri.ts:49-76` - escape `#` and `?` in the path part before `fileURLToPath`; today `fileURLToPath('file:///home/u/src/C#/app')` is `/home/u/src/C`, so a session in `~/src/C#/app` whose working directory was built unencoded is read as `~/src/C`, and `lifecycle.ts:731`, `changesets.ts:40` and `chatactions.ts:183` run there.
- `UPDATE: packages/sdk/src/fileuri.ts:34-48` - the comment says a `#` and a `?` are path.
- `UPDATE: packages/sdk/test/fileuri.test.ts` - the cases below.

## Steps

1. Failing cases first: `localPath('file:///home/u/src/C#/app')` is `/home/u/src/C#/app`, `localPath('file:///a/b?c')` is `/a/b?c`, and `localPath(uriOf('/a/C#/x?y'))` is `/a/C#/x?y`. The first two fail today.
2. Escape the two characters in the path part, then read it as today.

## Validation

- The first two cases fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/sdk/test/fileuri.test.ts`.

## Resume
