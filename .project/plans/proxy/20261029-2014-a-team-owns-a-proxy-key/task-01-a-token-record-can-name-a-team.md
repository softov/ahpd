---
title: A token record can name a team
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/users.ts](../../../../packages/sdk/src/types/users.ts) - `TokenRecord`, `Principal` and `Users`"
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - the tokens file reader, `verify`, `principalOf` and `mintToken`"
---

## Objective

A token record names a person in `user` or a team in `team`, never both.
`users.verifyTeamKey(token)` answers a principal for a live team key, and `users.verify` answers nothing for it.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:299-357` - `TokenRecord` makes `user` optional, adds `team?: string`, and says one of them is set.
- `UPDATE: packages/sdk/src/types/users.ts:42-160` - adds `team?: string` to `Principal`: the team a team key stands for.
- `UPDATE: packages/sdk/src/types/users.ts:448-478` - adds `verifyTeamKey(token)` to `Users`.
- `UPDATE: packages/sdk/src/access/users.ts:908-983` - the tokens file reader refuses a record with both or neither of `user` and `team`.
- `UPDATE: packages/sdk/src/access/users.ts:1227-1283` - `verify` skips a team key, and `verifyTeamKey` compares the same hashes and answers a team principal.
- `UPDATE: packages/sdk/src/access/users.ts:1595-1682` - `mintToken` takes `{ team }` in place of a person, checks the team, the grants and the scope, and counts the team's live keys.
- `UPDATE: packages/sdk/test/users-tokens.test.ts` - the record, the two verifies and the mint.

## Steps

1. Make `user` optional in `TokenRecord`, add `team`, and write one comment: a record holds exactly one of them.
2. Make the tokens file reader refuse a record with both or neither of them.
3. Make the reader refuse a `team` that is not a non-empty string.
4. Make `verify` answer nothing when the matched token record names a team.
5. Write `verifyTeamKey(token)`: compare every hash as `verify` does, and answer only a live team key.
6. Give the team principal the id `team:<team>`, no roles, and `team` and `token` set.
7. Make its `can` hold a grant only when the key's grants hold it and it is `proxy:call` or `proxy:models`.
8. Make its `standing` refuse when the team is not in the users file or the key is gone or expired.
9. Give it `keyScope`, `keyMeta` and `keyLimits` read from the live record, and `memberships` of its team alone.
10. Make `mintToken` take a team: refuse a team the users file does not name.
11. Refuse a team key with no grants, or with a grant outside the proxy's two.
12. Fill a team key's missing scope with its team, and refuse a scope of another team.
13. Count the team's live keys against `tokensPerPerson`.
14. Write the tests.

## Validation

- `users-tokens.test.ts`: a tokens file with both `user` and `team`, or neither, is reported as broken.
- `users-tokens.test.ts`: `verify` answers nothing for a team key; `verifyTeamKey` answers its principal; an expired key or a removed team answers nothing.
- `users-tokens.test.ts`: the principal holds `proxy:call` and refuses `session:read`; its scope defaults to the team.
- `users-tokens.test.ts`: the mint refuses an unknown team, a grant outside the proxy, a scope of another team, and the eleventh key.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

