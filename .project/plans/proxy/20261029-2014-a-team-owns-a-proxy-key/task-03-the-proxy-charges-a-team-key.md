---
title: The proxy charges a team key to its team
status: done
depends: [task-01-a-token-record-can-name-a-team.md]
layer: "sdk, server, docs"
refs:
  - "[code://packages/server/src/proxy/caller.ts](../../../../packages/server/src/proxy/caller.ts) - `callerOf` asks `verifyTeamKey`"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - `chargedAs`"
  - "[code://packages/sdk/src/access/decide.ts](../../../../packages/sdk/src/access/decide.ts) - `scoped`"
---

## Objective

A proxy call made with a team key is checked as the team, and its record's owner is `team:<team>`.
The websocket, `/api` and the daemon's door refuse the key, because they ask `users.verify` alone.

## Files

- `UPDATE: packages/server/src/proxy/caller.ts:89-139` - `callerOf` asks `users.verifyTeamKey` when `users.verify` answers nothing.
- `UPDATE: packages/server/src/proxy/listener.ts:482-505` - `chargedAs` charges a principal with `team` as `team:<team>`.
- `UPDATE: packages/sdk/src/access/decide.ts:131-143` - `scoped` never matches a `user:` row for a principal with `team`.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - a call with a team key.
- `UPDATE: packages/server/test/proxy-policy-usage.test.ts` - the record and the policy rows.
- `UPDATE: packages/server/test/server-http.test.ts` - a team key is refused on `/api`.
- `UPDATE: docs/server/PROXY.md:51-78` - "Who may call" names a team key.
- `UPDATE: docs/sdk/AUTHENTICATION.md` - a team key opens the proxy and no other door.

## Steps

1. In `callerOf`, ask `verifyTeamKey` when `verify` answers nothing, before the refusal.
2. Check `standing` and `can` for the team principal exactly as for a person.
3. In `chargedAs`, set the owner to `team:<team>` when the principal has `team`.
4. In `scoped`, answer false for a `user:` row when the principal has `team`.
5. Check with `rg -n "users\.verify" packages` that no other door asks `verifyTeamKey`.
6. Write the tests and the docs.

## Validation

- `proxy-listener.test.ts`: a team key's call is answered; `/v1/models` lists what the team's policies allow.
- `proxy-policy-usage.test.ts`: the record's owner is `team:backend`; a `user:` row is not a candidate; a `team:backend` row is.
- `server-http.test.ts`: the same key is 401 on `/api`.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

