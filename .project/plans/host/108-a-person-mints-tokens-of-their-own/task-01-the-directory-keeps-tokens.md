---
title: The directory keeps a person's tokens
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/users.ts#L296-L398](../../../../packages/sdk/src/types/users.ts#L296-L398) - the `Users` port, where `mint` is the one credential call today"
  - "[code://packages/sdk/src/types/users.ts#L152-L156](../../../../packages/sdk/src/types/users.ts#L152-L156) - `UserRecord.token`, the full token, which stays as it is"
  - "[code://packages/sdk/src/access/users.ts#L376-L446](../../../../packages/sdk/src/access/users.ts#L376-L446) - `FileUserOptions`, where the limit and the tokens file go"
  - "[code://packages/sdk/src/access/users.ts#L449-L450](../../../../packages/sdk/src/access/users.ts#L449-L450) - `hashOf`, the stored form of a secret"
  - "[code://packages/sdk/src/access/users.ts#L799-L815](../../../../packages/sdk/src/access/users.ts#L799-L815) - `write`, the atomic owner-only write that refuses a broken file"
  - "[code://packages/sdk/src/access/users.ts#L1266-L1284](../../../../packages/sdk/src/access/users.ts#L1266-L1284) - `remove` and `mint`, the pattern for the new calls"
---

## Objective

`fileUsers()` keeps a list of tokens for each person in a tokens file of its own, beside the users file.
A person's tokens are minted, listed and revoked through three new calls on the `Users` port, and the users file does not change.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:296-398` - add `TokenRecord`, `MintedToken`, and the optional `mintToken`, `tokens` and `revokeToken` calls on `Users`.
- `UPDATE: packages/sdk/src/access/users.ts:376-446` - add `tokensPerPerson` and `tokensPath` to `FileUserOptions`.
- `UPDATE: packages/sdk/src/access/users.ts:1266-1284` - add the three calls beside `mint`, and make `remove` drop the person's tokens.
- `UPDATE: packages/sdk/src/index.ts:86-98` - export the new types.
- `CREATE: packages/sdk/test/users-tokens.test.ts` - the tests of the store, the limit and the refusals.

## Steps

1. Write the tests first, against a users file and a tokens file in a temporary folder.
2. Add `TokenRecord` to `types/users.ts`: `id`, `user`, `label`, `grants?`, `created`, `expires?` and `token`, the `sha256:<hex>` hash.
3. Document that a `TokenRecord` without `grants` holds every grant of its person, read at each check.
4. Add `MintedToken`: the `TokenRecord` without its hash, plus the `secret` that the mint answers once.
5. Add `mintToken(user, { label?, grants?, expires? })`, `tokens(user?)` and `revokeToken(id)` to `Users` as optional calls, like `watch`.
6. Add `tokensPerPerson?: number` to `FileUserOptions`, with 10 as the default.
7. Add `tokensPath?: string` to `FileUserOptions`, defaulting to `<users file without .json>.tokens.json` in the same folder.
8. Read the tokens file on every call, as `read` does, and read a missing file as no tokens.
9. Read a malformed tokens file as no tokens, report it once with `onProblem`, and refuse to write over it.
10. Write the tokens file with `writeJsonAtomic`, owner-only, as `write` does for the users file.
11. In `mintToken`, refuse a person who is not in the users file, with the sentence `mint` uses.
12. In `mintToken`, refuse a grant the person does not hold now, and name the grant in the refusal.
13. In `mintToken`, refuse an `expires` that is not a date or that is not in the future.
14. In `mintToken`, refuse the mint when the person already holds `tokensPerPerson` tokens, and name the limit.
15. Count only the person's tokens that have not expired, so an expired token does not hold a place.
16. Make the secret with `randomBytes(32).toString('base64url')`, and keep only `hashOf(secret)` in the file.
17. Make the id with `randomBytes(6).toString('base64url')`, and make a new one if the file already holds it.
18. In `tokens`, answer the records without their hashes, for one person or for all, sorted by `created`.
19. In `revokeToken`, remove the token with that id, and answer `false` when the file does not hold it.
20. In `remove`, remove every token of the person too, so a person added again gets none back.
21. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `users-tokens.test.ts`: a mint answers the secret once, and the tokens file holds only its hash.
- `users-tokens.test.ts`: the users file is the same, byte for byte, after a mint and a revoke.
- `users-tokens.test.ts`: the default limit refuses the eleventh mint, and `tokensPerPerson: 2` refuses the third.
- `users-tokens.test.ts`: an expired token does not count against the limit.
- `users-tokens.test.ts`: a grant the person does not hold, an unknown person and a past `expires` are each refused.
- `users-tokens.test.ts`: `revokeToken` removes the token, and answers `false` for an unknown id.
- `users-tokens.test.ts`: `remove` drops the person's tokens, and an `add` of the same id lists none.
- `users-tokens.test.ts`: a malformed tokens file reads as no tokens and refuses a mint.
- `pnpm exec vitest run packages/sdk/test/users-tokens.test.ts packages/sdk/test/users.test.ts` passes.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** every step. `TokenRecord` and `MintedToken` are in `types/users.ts`, and `Users` carries optional `mintToken`, `tokens` and `revokeToken`. `fileUsers` has `tokensPerPerson` (default 10) and `tokensPath` (default the users file with `.tokens.json` beside it). It reads the tokens file on every call, keeps only `hashOf(secret)` in it, and writes `{ tokens: [...] }` with `writeJsonAtomic`. A malformed file reads as no tokens, is reported once, and refuses a mint. `remove` drops the person's tokens. `users-tokens.test.ts` has 12 cases, including the byte-for-byte users file, both limits, an expired token not counting, and the malformed file.
- **Next action:** task 02, which makes `verify` read the tokens file and narrow the principal.
- **Open questions:** none.
- **Watch out for:** the tokens file is `{ tokens: [...] }` and `created`/`expires` are epoch milliseconds; task 02 hands `expires` straight to `Principal.expiresAt`. A broken tokens file is left alone by `remove`, because no token reads from it and the hand that broke it should fix it.
