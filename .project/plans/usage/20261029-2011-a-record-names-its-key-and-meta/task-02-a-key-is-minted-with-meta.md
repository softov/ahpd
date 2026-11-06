---
title: A key is minted with meta
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/users.ts](../../../../packages/sdk/src/types/users.ts) - `TokenRecord` gets `meta`"
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - the tokens file reader and `mintToken`"
  - "[code://packages/sdk/src/access/tokens.ts](../../../../packages/sdk/src/access/tokens.ts) - the `meta` param"
  - "[code://packages/server/src/commands/token.ts](../../../../packages/server/src/commands/token.ts) - the `--meta` flag and the list line"
---

## Objective

`ahpd token mint --meta env=prod --meta team=ops` and `x-ahpd/tokens/mint { meta }` write a token record with that meta.
One helper checks meta against the bounds, and task 03 uses the same helper for the header.

## Files

- `CREATE: packages/sdk/src/access/meta.ts` - `checkMeta`, which checks a map against the bounds, and `parseMeta`, which reads `k=v,k=v`.
- `UPDATE: packages/sdk/src/index.ts` - exports `checkMeta` and `parseMeta`.
- `UPDATE: packages/sdk/src/types/users.ts:290-337` - adds `meta?: Record<string, string>` to `TokenRecord`, and the mint options type gets `meta`.
- `UPDATE: packages/sdk/src/access/users.ts:907-967` - the tokens file reader accepts `meta` only when `checkMeta` accepts it.
- `UPDATE: packages/sdk/src/access/users.ts:1566-1651` - `mintToken` checks `meta` and writes it.
- `UPDATE: packages/sdk/src/access/tokens.ts:38-162` - `x-ahpd/tokens/mint` takes `meta` as an object of strings.
- `UPDATE: packages/server/src/commands/token.ts:128-277` - `--meta <key=value>`, repeatable, on `token mint`, and the meta in each `token list` line.
- `CREATE: packages/sdk/test/meta.test.ts` - the bounds and the parse.
- `UPDATE: packages/sdk/test/users-tokens.test.ts` - the mint with meta.
- `UPDATE: packages/server/test/token-command.test.ts` - the flag and the list line.

## Steps

1. Write `checkMeta(meta)`: a key is 1 to 64 characters of `[A-Za-z0-9_.-]`.
2. In `checkMeta`, refuse a value that is not a string or is longer than 256 characters.
3. In `checkMeta`, refuse a value that holds a comma or a line break.
4. In `checkMeta`, refuse more than 32 entries, and throw one sentence that names the entry at fault.
5. Write `parseMeta(text)`: split on commas, split each part at its first `=`, trim spaces, and call `checkMeta`.
6. Make `parseMeta` refuse a part with no `=`, and a key named twice.
7. Add `meta` to `TokenRecord` and to the mint options, and check it in the reader and in `mintToken`.
8. Add the `meta` param to `x-ahpd/tokens/mint`, refused with `INVALID_PARAMS` when `checkMeta` refuses it.
9. Add the repeatable `--meta` flag, and refuse a flag value that `parseMeta` refuses.
10. Add `meta k=v,k=v` to each `token list` line that has meta.

## Validation

- `meta.test.ts`: each bound at its limit is accepted, and one past it is refused.
- `meta.test.ts`: `a=1, b=2` parses to two entries; `a`, `=1`, `a=1,a=2` and `a=x,y` are refused.
- `users-tokens.test.ts`: a mint with meta writes it; a tokens file with a bad meta is reported as broken.
- `token-command.test.ts`: two `--meta` flags reach the record, and `token list` shows them.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

- **Done so far:** `checkMeta` and `parseMeta` are in `packages/sdk/src/access/meta.ts`, both throwing `-32602` with one sentence. `TokenRecord.meta?` and the mint options carry `meta`; the tokens file reader reports a bad one as a broken file, and `mintToken` checks it after the limits and before the per-person count. `x-ahpd/tokens/mint` takes `meta` as an object of names to values. `ahpd token mint` has a repeatable `--meta NAME=VALUE` and `token list` prints `meta k=v,k=v` on each line that has one.
- **Next action:** [task-03-a-call-adds-meta-with-a-header.md](task-03-a-call-adds-meta-with-a-header.md).
- **Open questions:** none.
- **Watch out for:** an empty `parseMeta` text answers `{}` rather than a refusal, so an empty header names no meta. `parseMeta` refuses a name written twice, and the `--meta` flag refuses one written twice across two flags. `meta` is checked before the per-person token count, so a refused meta spends no slot.

Files changed by this task: `packages/sdk/src/access/meta.ts`, `packages/sdk/src/index.ts`, `packages/sdk/src/types/users.ts`, `packages/sdk/src/access/users.ts`, `packages/sdk/src/access/tokens.ts`, `packages/server/src/commands/token.ts`, `packages/sdk/test/meta.test.ts`, `packages/sdk/test/users-tokens.test.ts`, `packages/sdk/test/token-methods.test.ts`, `packages/server/test/token-command.test.ts`.

