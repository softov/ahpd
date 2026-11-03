---
title: A key that went sends a replacement
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/root.ts#L675-L688](../../../../packages/sdk/src/host/root.ts#L675-L688) - `daemonValuesMoved`"
---

## Objective

A daemon key the file no longer holds sends a `root/configChanged` that replaces the root's values with every value it still holds.
A key whose value moved still sends a merge of that key.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:675-688` - the replacement, and the merge for a key that moved.
- `UPDATE: packages/sdk/test/root-config.test.ts:100-170` - the helper drops a key and hands the host back.
- `UPDATE: packages/sdk/test/root-config.test.ts:890-895` - the case of a key the file no longer holds.

## Steps

1. Send a replacement of the root's values where a daemon key the root holds is gone from the file.
2. Carry this host's own keys, the daemon's remaining ones, each account and the restart mark in it.
3. Keep the merge for a key whose value moved.
4. Cover a dropped key in a case, through the host's own `daemonValuesMoved`.

## Validation

- `packages/sdk/test/root-config.test.ts`: the new case fails on `cde4dd6c` and passes after.
- The root config test file passes.
- `pnpm run typecheck` is clean.

## Resume

Not started.
