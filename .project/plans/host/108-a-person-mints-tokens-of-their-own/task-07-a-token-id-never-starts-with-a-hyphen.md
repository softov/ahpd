---
title: A token id never starts with a hyphen
status: done
depends: [task-04-the-token-commands.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/access/users.ts#L1483-L1484](../../../../packages/sdk/src/access/users.ts#L1483-L1484) - the id of a minted token, 6 random bytes in base64url"
  - "[code://packages/server/src/commands/user.ts#L84-L89](../../../../packages/server/src/commands/user.ts#L84-L89) - `idOf`, which refuses an id that starts with `-` as an unknown flag"
  - "[code://packages/server/src/commands/token.ts#L241-L278](../../../../packages/server/src/commands/token.ts#L241-L278) - `token rm`, which reads its id with `idOf`"
  - "[code://packages/server/test/token-command.test.ts#L219-L230](../../../../packages/server/test/token-command.test.ts#L219-L230) - the test that fails when the minted id starts with `-`"
---

## Objective

A minted token id is 8 base64url characters, and about 1 id in 64 starts with `-`.
`token rm` reads its id with `idOf`, which refuses an id that starts with `-`.
The person cannot revoke that token, and the HTTP answer is 400.
The token test in `packages/server` fails on CI for the same reason.
A mint now gives an id that does not start with `-`.
No release has token minting yet, so no kept token has such an id.

## Files

- `UPDATE: packages/sdk/src/access/users.ts:1483-1484` - a mint makes a new id while the id starts with `-` or another token has it.
- `UPDATE: packages/sdk/test/users-tokens.test.ts` - a mint whose first random id starts with `-` keeps the next id.

## Steps

1. In `mintToken`, make a new id while the id starts with `-` or another token has the same id.
2. Add a test that stubs `randomBytes` so the first id starts with `-`.
3. In that test, expect the minted id to be the second id, which starts with a letter.
4. Revoke the minted token with `token rm` in the same test, or in `token-command.test.ts`, and expect 200.
5. Set this task and the plan row to `implemented`.

## Validation

- The sdk and server tests pass from the repository root.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** every step. `mintToken` draws another 6-byte id while the id starts with `-` or another token holds it. `packages/sdk/test/users-tokens.test.ts` queues two ids for `randomBytes`, the first spelling `-AAAAAAA`, and sees the mint keep `AAAAAAAA`, store it and revoke it. `packages/server/test/token-command.test.ts` mints over `/api` with the same queue, then revokes the id it answered with `token rm` and expects 200. The sdk and server suites pass from the root (234 files, 4563 tests), as do `pnpm -s build`, `pnpm -s typecheck` and `pnpm boundary`.
- **Next action:** none; every task in the plan is implemented.
- **Open questions:** none.
- **Watch out for:**
  - base64url spells `-` in about 1 id in 64, and `_` in another 1 in 64. Only `-` reads as a flag, so only it is drawn again.
  - Both test files stub `node:crypto`, keeping the real module under a queue. The 32-byte secret comes from the real source once the queue is empty.
  - The server test's directory signs the three people in before the case mints a token, so the queue reaches the token's own first id.
