---
title: vault set and delete refuse --config-file
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/vault.ts#L139-L141](../../../../packages/server/src/commands/vault.ts#L139-L141) - `fields`, `vaultAt` on every verb"
  - "[code://packages/server/src/commands/vault.ts#L206-L213](../../../../packages/server/src/commands/vault.ts#L206-L213) - `vault list`, the one that reads it"
  - "[code://packages/server/test/server-commands.test.ts#L633](../../../../packages/server/test/server-commands.test.ts#L633) - the assertion that pins it on all three"
  - "[code://.project/plans/daemon/15-a-verb-declares-only-its-own-flags/implemented.md#L36](../../../../.project/plans/daemon/15-a-verb-declares-only-its-own-flags/implemented.md#L36) - listed as left for later"
---

## Objective

`vault list` declares `--config-file`; `vault set` and `vault delete` do not, and refuse it as any unknown option.

## Files

- `UPDATE: packages/server/src/commands/vault.ts:139-141` - `vaultAt` on `vault list` only; today all three declare it and `set` and `delete` reach the vault through `vaultPath()`, so `ahpd vault set host:x --config-file other.json` writes the default vault and the flag means nothing.
- `UPDATE: packages/server/test/server-commands.test.ts:633` - `vault.list` offers `--config-file`, `vault.set` and `vault.delete` offer nothing of the daemon's.
- `UPDATE: packages/server/test/server-cli.test.ts` - the case below.

## Steps

1. Failing case first: `ahpd vault delete host:orders --config-file <file>` exits 2 with `Unknown option --config-file`. Today it runs.
2. Change the test's assertion and see it fail before the fix.
3. Declare `vaultAt` on `vault list` alone.

## Validation

- Both fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts`.

## Resume
