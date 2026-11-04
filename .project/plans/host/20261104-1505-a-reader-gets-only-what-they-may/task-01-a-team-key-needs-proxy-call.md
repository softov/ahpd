---
title: A team key needs proxy call
status: implemented
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/access/tokens.ts#L157-L160](../../../../packages/sdk/src/access/tokens.ts#L157-L160) - `boundTeam`"
  - "[code://packages/server/src/commands/token.ts#L244-L248](../../../../packages/server/src/commands/token.ts#L244-L248) - the CLI bound"
---

## Objective

A caller mints a team key only when it holds `user:write` and `proxy:call`.

## Files

- `UPDATE: packages/sdk/src/access/tokens.ts:157-160` - `boundTeam` refuses a reader without `proxy:call`, with the same refusal as for `user:write`.
- `UPDATE: packages/server/src/commands/token.ts:244-248` - the team bound asks for `user:write` and `proxy:call`.
- `UPDATE: packages/sdk/test/token-methods.test.ts` - a case for a reader with `user:write` and no `proxy:call`.
- `UPDATE: packages/server/test/token-command.test.ts` - a case for the served command.
- `UPDATE: docs/server/USERS.md` - who may mint a team key, and that a removed team takes its keys.

## Steps

1. In `boundTeam`, check `proxy:call` after `user:write`, and throw `RpcError(-32009, refusalReason(reader.id, 'proxy:call'))`.
2. In the CLI, add `proxy:call` to the grants `bounded` asks for a team key.
3. Add the RPC case: refuse a reader with `user:write` only, and give the key to a reader with both.
4. Add the CLI case with the same two readers.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass, run one at a time.

## Resume

- **Done so far:** every step.
- **Found:** `boundTeam` also guards listing and revoking a team's keys. Only minting asks `proxy:call`, so a user administrator without it can still revoke a key. `docs/server/USERS.md` says so.
