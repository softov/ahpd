---
title: One file URI reader and one writer
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/resources.ts#L32-L41](../../../../packages/sdk/src/resources.ts#L32-L41) - `pathOf` and `uriOf`, which already decode and encode"
  - "[code://packages/sdk/src/host/channels.ts#L19-L20](../../../../packages/sdk/src/host/channels.ts#L19-L20) - the unencoded `uriOf`, which goes"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L249](../../../../packages/sdk/src/host/sessionmethods.ts#L249) - its one caller, the `@` completion's attachment URI"
  - "[code://packages/sdk/src/debuglogs.ts#L43](../../../../packages/sdk/src/debuglogs.ts#L43) - `asPath`, a hand-written decoder that becomes `localPath`"
---

## Objective

The sdk has one `localPath(uri)` that turns a `file:` URI into a decoded path and never throws, and one `uriOf(path)` that encodes; the second, unencoded `uriOf` is gone.

## Files

- `CREATE: packages/sdk/src/fileuri.ts` - `localPath(value: string): string` and `uriOf(path: string): string`.
- `UPDATE: packages/sdk/src/resources.ts:32-41` - `pathOf` keeps its two refusals and decodes through `fileURLToPath` as now; `uriOf` is imported from `fileuri.ts` and re-exported under the same name.
- `UPDATE: packages/sdk/src/host/channels.ts:19-20` - `uriOf` removed.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:6,249` - imports `uriOf` from `../fileuri.js`.
- `UPDATE: packages/sdk/src/debuglogs.ts:43` - `asPath` is `localPath`.
- `CREATE: packages/sdk/test/fileuri.test.ts` - the cases below.

## Steps

1. `localPath`: a value not starting with `file://` is returned as it is; `file:///a/b` is `fileURLToPath`'s answer; a URI with an authority (`file://host/a`) drops the authority, as `terminals.ts:126` does today; a URI `fileURLToPath` refuses, or with a `%` that does not decode, falls back to the text after `file://`, so no caller that never threw starts throwing.
2. `uriOf` is `pathToFileURL(path).href`.
3. Nothing in `fileuri.ts` touches the filesystem, so `channels.ts`'s reason for its own copy no longer holds.

## Validation

- `fileuri.test.ts`, a new helper's cases: `localPath('file:///home/a/my%20dir')` is `/home/a/my dir`; `localPath('/plain/path')` is unchanged; `localPath('file:///a/100%')` is `/a/100%`; `localPath('file://host/a/b')` is `/a/b`; `uriOf('/home/a/my dir')` is `file:///home/a/my%20dir`; `localPath(uriOf(p)) === p` for a path with a space, a `#`, a `%` and a non-ASCII letter.
- Written first and seen failing (the attachment URI is `file:///.../my dir/x` today): in `host-files.test.ts` beside the `@` completion case at line 270, a completion under a directory with a space answers an encoded attachment URI.
- The existing `debuglogs` and resource tests stay green.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
