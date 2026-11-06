---
title: A team key is minted, listed and revoked
status: done
depends: [task-01-a-token-record-can-name-a-team.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/access/tokens.ts](../../../../packages/sdk/src/access/tokens.ts) - the three token commands and `authorize`"
  - "[code://packages/server/src/commands/token.ts](../../../../packages/server/src/commands/token.ts) - the `--team` flag"
---

## Objective

`x-ahpd/tokens/mint`, `list` and `revoke` take `team`, and `ahpd token mint`, `list` and `revoke` take `--team`.
Only root and a caller who holds `user:write` reach them for a team.

## Files

- `UPDATE: packages/sdk/src/access/tokens.ts:133-221` - the commands take `team`, refuse it beside `user`, and `authorize` refuses a caller who names a team.
- `UPDATE: packages/server/src/commands/token.ts:149-307` - `--team <team>` on `mint`, `list` and `revoke`, refused beside `--user`.
- `UPDATE: packages/sdk/test/token-methods.test.ts` - the `team` param and who may use it.
- `UPDATE: packages/server/test/token-command.test.ts` - the flag.
- `UPDATE: docs/server/USERS.md:37-71` - "Tokens of their own" says how to mint a team key.

## Steps

1. Read `team` in the three commands as a non-empty string, and refuse it beside `user`.
2. Make `authorize` answer false when the params name a team.
3. Pass the team to `mintToken`, and list or revoke only the keys of that team.
4. Add `--team` to the three subcommands, and refuse it beside `--user`.
5. Show `team <team>` in place of the person in each `token list` line of a team key.
6. Write the tests and the docs.

## Validation

- `token-methods.test.ts`: a caller who holds `user:write` mints, lists and revokes a team key; a caller without it is refused for a team.
- `token-methods.test.ts`: `team` beside `user` is `INVALID_PARAMS`.
- `token-command.test.ts`: `--team backend --grant proxy:call` reaches the mint; `--team` with `--user` is refused.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

