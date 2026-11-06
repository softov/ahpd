---
title: A token signs in as its person, narrowed
status: done
depends: [task-01-the-directory-keeps-tokens.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/access/users.ts#L948-L957](../../../../packages/sdk/src/access/users.ts#L948-L957) - `verify`, which compares every record's hash and keeps the match"
  - "[code://packages/sdk/src/access/users.ts#L846-L917](../../../../packages/sdk/src/access/users.ts#L846-L917) - `principalOf`, with `standing` and `can` re-read on each call"
  - "[code://packages/sdk/src/types/users.ts#L40-L91](../../../../packages/sdk/src/types/users.ts#L40-L91) - `Principal`, with `standing` and `expiresAt`"
  - "[code://packages/server/src/commands/authorize.ts#L84-L88](../../../../packages/server/src/commands/authorize.ts#L84-L88) - the HTTP gate, which asks `standing` on each request"
  - "[code://packages/server/src/proxy/caller.ts#L99-L106](../../../../packages/server/src/proxy/caller.ts#L99-L106) - the proxy gate, which asks `standing` and `can` on each call"
  - "[code://packages/sdk/src/host/admission.ts#L370](../../../../packages/sdk/src/host/admission.ts#L370) - the AHP gate, which asks `standing` on each command"
  - "[code://packages/server/src/proxy/listener.ts#L418](../../../../packages/server/src/proxy/listener.ts#L418) - `policyFor`, which charges the call to the principal's id"
---

## Objective

`verify` answers a minted token as its person, with only the grants that both the token and the person hold.
A revoked token, an expired token and a token whose person is gone fail on the next call, at every gate.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:40-91` - add the optional `token` field, the id of the minted token the principal signed in with.
- `UPDATE: packages/sdk/src/access/users.ts:846-917` - give `principalOf` the token record, and narrow `can` and `standing` by it.
- `UPDATE: packages/sdk/src/access/users.ts:948-957` - compare the minted tokens' hashes in the same loop as the records' hashes.
- `UPDATE: packages/sdk/test/users-tokens.test.ts` - the tests of the sign-in, the grants, the revoke and the expiry.
- `UPDATE: packages/server/test/server-http.test.ts` - a proxy-only token at the HTTP API and at the proxy.

## Steps

1. Write the tests first.
2. In `verify`, read the tokens file once, beside the users file.
3. Compare the hash with every record's `token` and with every minted token's hash, with `same`, in one pass.
4. Keep the match in a variable and do not return early, so the time does not tell which hash matched.
5. Do the expiry and person checks after the pass, never inside it.
6. Answer `undefined` for a matched token whose person is not in the users file.
7. Answer `undefined` for a matched token whose `expires` has passed.
8. Build the principal from the person's record, with `token` set to the token's id.
9. Set `expiresAt` from the token's `expires`, so a client knows when it ends.
10. Keep `trusted` as the person's record says, because `can` limits what the token does.
11. In `can`, re-read the tokens file, and answer `false` when the token is not there.
12. In `can`, answer `true` only when the person holds the grant now and the token's `grants` hold it.
13. Read a token without `grants` as holding every grant of its person.
14. In `standing`, answer `false` when the person is gone, or the token is gone or expired.
15. Leave the principal's `id` as the person's id, so usage and policies charge the person.
16. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `users-tokens.test.ts`: a minted secret verifies as its person, with `token` set to its id.
- `users-tokens.test.ts`: a token with `proxy:write` only answers `can('proxy:call')` true and `can('session:write')` false.
- `users-tokens.test.ts`: when the person loses `proxy:write`, the same principal answers `can('proxy:call')` false.
- `users-tokens.test.ts`: after `revokeToken`, the principal's `standing` and `can` both answer `false`, and `verify` answers `undefined`.
- `users-tokens.test.ts`: with a fake clock past `expires`, `standing` answers `false` and `verify` answers `undefined`.
- `users-tokens.test.ts`: after `remove` of the person, `verify` of their token answers `undefined`.
- `users-tokens.test.ts`: `verify` compares every entry for a match and for a miss, counted with `vi.mock` of `same`.
- `server-http.test.ts`: `user list` refuses a proxy-only token with `403`, and the proxy lets it in.
- `server-http.test.ts`: the API refuses a revoked token with `401` on its next request.
- `pnpm exec vitest run packages/sdk/test/users-tokens.test.ts packages/server/test/server-http.test.ts` passes.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** every step, and all seven sign-in cases pass.
- `Principal` has the optional `token` id.
- `verify` reads the tokens file once and compares every record hash and every token hash with `same` in one pass. It keeps both matches, then rejects a token whose person is gone or whose `expires` passed.
- `principalOf` takes the token record and sets `token` and `expiresAt`.
- `standing` and `can` re-read the tokens file. The token has to be there, belong to the person, and be unexpired.
- `can` asks both the person's roles and the token's grants now, with no `grants` meaning every grant of the person.
- `users-tokens.test.ts` counts five comparisons with a `vi.mock` of `same`, for a match and for a miss.
- `server-http.test.ts` has a proxy-only token: 403 at `user list`, 200 at `/v1/models`, and 401 after its revoke.
- **Next action:** task 03, the `tokensPerPerson` configuration key. Task 04 depends on 02 and 03.
- **Open questions:** none. The proxy case mints `proxy:read`, because `/v1/models` asks for `proxy:models`, which `proxy:write` does not cover.
- **Watch out for:** a token record without `grants` is read at each check, so a role added later widens it. That is the plan's "all access"; a narrow token names its grants.
