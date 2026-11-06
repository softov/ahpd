---
title: A removed team takes its keys
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/access/users.ts#L1659-L1667](../../../../packages/sdk/src/access/users.ts#L1659-L1667) - `removeTeam`"
  - "[code://packages/sdk/src/access/users.ts#L1679-L1693](../../../../packages/sdk/src/access/users.ts#L1679-L1693) - `remove`, the pattern"
---

## Objective

When a team goes, its keys go from the tokens file, so a team added back with the same id has no old keys.

## Files

- `UPDATE: packages/sdk/src/access/users.ts:1659-1667` - `removeTeam` writes the tokens file without the tokens whose `team` is the id.
- `UPDATE: packages/sdk/test/users-tokens.test.ts` - a case that removes a team, adds it back, and checks that the old key is refused.

## Steps

1. After `removeTeam` writes the users file, read the tokens with `readTokens()`.
2. If the file is not `broken`, write it without each token whose `team` is the id, as `remove` does.
3. Add a case: mint a team key, remove the team, add it back, and verify the key.

## Validation

- The new case fails without the change and passes with it.
- `pnpm --filter @ahpd/sdk test` passes, run alone.

## Resume

- **Done so far:** every step. `docs/server/USERS.md` says a removed team takes its keys.
