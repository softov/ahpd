---
title: A team owns a proxy key
domain: proxy
status: built
priority: medium
created: 2026-10-29
revalidated: 2026-10-29
refs:
  - git://817615bc:.project/briefs/a-proxy-key-names-what-it-charges.md - the brief this plan covers, part 2
  - git://97957653 - the commit of `main` the facts were checked at
  - "[code://packages/sdk/src/types/users.ts#L299-L357](../../../../packages/sdk/src/types/users.ts#L299-L357) - `TokenRecord`, whose `user` becomes one of `user` and `team`"
  - "[code://packages/sdk/src/types/users.ts#L448-L458](../../../../packages/sdk/src/types/users.ts#L448-L458) - `Users.verify`, which answers a person"
  - "[code://packages/sdk/src/access/users.ts#L1227-L1263](../../../../packages/sdk/src/access/users.ts#L1227-L1263) - `verify`, which compares every hash"
  - "[code://packages/sdk/src/access/users.ts#L1595-L1682](../../../../packages/sdk/src/access/users.ts#L1595-L1682) - `mintToken`, which needs a person today"
  - "[code://packages/sdk/src/access/tokens.ts#L133-L221](../../../../packages/sdk/src/access/tokens.ts#L133-L221) - the token commands, and `authorize` for a caller without `user:write`"
  - "[code://packages/server/src/commands/token.ts#L206-L307](../../../../packages/server/src/commands/token.ts#L206-L307) - `ahpd token mint`, `list` and `revoke`"
  - "[code://packages/server/src/proxy/caller.ts#L89-L139](../../../../packages/server/src/proxy/caller.ts#L89-L139) - `callerOf`, the one door a team key opens"
  - "[code://packages/server/src/proxy/listener.ts#L482-L505](../../../../packages/server/src/proxy/listener.ts#L482-L505) - `chargedAs`, which charges a person as `user:<id>`"
  - "[code://packages/sdk/src/access/decide.ts#L131-L143](../../../../packages/sdk/src/access/decide.ts#L131-L143) - `scoped`, which matches `user:` rows by the principal's id"
  - "[code://packages/server/src/commands/authorize.ts#L84](../../../../packages/server/src/commands/authorize.ts#L84) - `/api` signs in through `users.verify`"
  - "[code://packages/sdk/src/host/handshake.ts#L591](../../../../packages/sdk/src/host/handshake.ts#L591) - the websocket signs in through `users.verify`"
  - "[code://packages/server/src/commands/run.ts#L611-L623](../../../../packages/server/src/commands/run.ts#L611-L623) - the daemon's door signs in through `users.verify`"
---

## Goal

A team holds a proxy key that belongs to no person.
A service, a CI job or a shared tool calls the proxy with it, and the team pays.
The key opens the proxy and nothing else, and a person who leaves the team does not take it with them.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "users\.verify|\.verify\(" packages/server/src packages/sdk/src` - four doors sign in with `users.verify`: the websocket, `/api`, the daemon's door and the proxy.
- `rg -n "one\.user|\.user ===" packages/sdk/src/access/users.ts` - the places that read a token's person.
- `rg -n "user:\\$\{" packages/server/src/proxy` - `chargedAs` is where a person's owner is written.

### Runtime path

```
ahpd token mint --team backend --scope backend:ci --grant proxy:call -> mintToken -> tokens file { team }
CI -> /v1 with the key -> callerOf: users.verify (no person) -> users.verifyTeamKey -> team principal
   -> scopeFor -> decide (no user: rows) -> record { owner: team:backend, token }
the same key on /api or the websocket -> users.verify answers nothing -> 401
```

### Gaps

- A token record must name a person.
- No principal stands for a team.
- A record's owner is a person or root for a proxy call.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A team key is for the proxy only | Softov, 2026-10-29: "a team key its only for proxy" | 01, 03 |
| Root and a caller who holds `user:write` mint a team key | Softov, 2026-10-29: "root and who have permission to mint keys" | 02 |
| A token record names exactly one of `user` and `team` | (defaulted: one owner for each key) | 01 |
| `users.verify` never answers a team key; `users.verifyTeamKey` does, and only the proxy calls it | (defaulted: the three other doors stay closed with no change to them) | 01, 03 |
| A team key holds only `proxy:call` and `proxy:models`, or a part of them | (defaulted: the grants of the proxy subject) | 01 |
| A team key's scope is its team or a project of it, and defaults to the team | (defaulted: the scope plan's lock, with the team as owner) | 01 |
| A team key keeps working while its team is in the users file | (defaulted: no person to lose a membership) | 01 |
| A team holds at most as many keys as a person may | (defaulted: `tokensPerPerson`) | 01 |
| A team key's call is charged to `team:<team>`, and `user:` rows never hold it | (defaulted: no person is behind the call) | 03 |

## Proposed architecture

- **Data flow** - the mint writes `team` in place of `user`. `verifyTeamKey` answers a principal whose `team` is set. The proxy charges it as `team:<team>`.
- **Event flow** - none.
- **State flow** - the tokens file holds both kinds of key. A team key's scope and limits are read live, the same way a person's key's are.
- **Layer responsibilities** - sdk: the record, the principal, `verifyTeamKey`, the mint and `scoped` · server: the proxy caller, `chargedAs`, the flags and the docs.
- **Source-of-truth files** - [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A token record can name a team](task-01-a-token-record-can-name-a-team.md) | done | - |
| [02 - A team key is minted, listed and revoked](task-02-a-team-key-is-minted-listed-revoked.md) | done | 01 |
| [03 - The proxy charges a team key to its team](task-03-the-proxy-charges-a-team-key.md) | done | 01 |

## Risks and tradeoffs

- A tokens file with a team key is not read by an older daemon. The reader of an older daemon refuses a record with no `user`, and no token signs in.
- A team key that leaks is the team's until it is revoked. Its scope and limits are what bound it.

## Resume state

- **Done so far:** [task-01-a-token-record-can-name-a-team.md](task-01-a-token-record-can-name-a-team.md), [task-02-a-team-key-is-minted-listed-revoked.md](task-02-a-team-key-is-minted-listed-revoked.md) and [task-03-the-proxy-charges-a-team-key.md](task-03-the-proxy-charges-a-team-key.md) are implemented.
  A record names a user or a team, `verify` refuses a team key, and `verifyTeamKey` answers its team.
  The mint makes a team key, and the token commands and `--team` manage it.
  The proxy answers it as `team:<team>`, and `user:` rows hold it never.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the plans of the scope, the meta and the limits change `TokenRecord` and `principalOf` first. A team principal reads `keyScope`, `keyMeta` and `keyLimits` the same way.

## Final verification checklist

- [x] `pnpm typecheck` passes.
- [x] `pnpm test` passes.
- [x] `ahpd token mint --team backend --grant proxy:call` mints a key, and a proxy call with it is recorded as `team:backend`.
- [x] The same key is refused on `/api` and on the websocket.
- [x] A person with no `user:write` cannot mint a team key.
