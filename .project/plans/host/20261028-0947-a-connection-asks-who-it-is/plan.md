---
title: A connection asks who it is
domain: host
status: built
priority: medium
created: 2026-10-28
revalidated: 2026-10-28
requires:
  - plans/host/108-a-person-mints-tokens-of-their-own/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/types/users.ts#L40-L125](../../../../packages/sdk/src/types/users.ts#L40-L125) - `Principal`, whose `roles` holds the record's roles and the sign-in's roles together"
  - "[code://packages/sdk/src/types/users.ts#L160-L190](../../../../packages/sdk/src/types/users.ts#L160-L190) - `UserRecord`, with `issuer` and `rolesFrom`"
  - "[code://packages/sdk/src/access/users.ts#L992-L1110](../../../../packages/sdk/src/access/users.ts#L992-L1110) - `principalOf`, which stamps the claim's roles and narrows a minted token in `can`"
  - "[code://packages/sdk/src/access/users.ts#L1309-L1312](../../../../packages/sdk/src/access/users.ts#L1309-L1312) - `grantsOfRoles`, which resolves roles to grants"
  - "[code://packages/sdk/src/access/tokens.ts#L98-L108](../../../../packages/sdk/src/access/tokens.ts#L98-L108) - `authorize` of the token methods, the pattern for a method that a reader may call for themselves"
  - "[code://packages/sdk/src/types/plugin.ts#L482-L506](../../../../packages/sdk/src/types/plugin.ts#L482-L506) - `PluginMethod`; `handle` gets the reader and the owner, `root:<host>` for root"
  - "[code://packages/sdk/src/usage/scopes.ts#L123-L129](../../../../packages/sdk/src/usage/scopes.ts#L123-L129) - `poolsFor`, the pools of one person"
  - "[code://packages/sdk/src/usage/meter.ts#L203-L211](../../../../packages/sdk/src/usage/meter.ts#L203-L211) - the meter charges work to its owner, so root's work goes to `root:<host>`"
  - "[code://packages/sdk/src/host/owners.ts#L75-L79](../../../../packages/sdk/src/host/owners.ts#L75-L79) - `ownerFor`, `user:<id>` or `root:<host>`"
  - "[code://packages/sdk/src/host/handshake.ts#L341-L346](../../../../packages/sdk/src/host/handshake.ts#L341-L346) - `ahpd.principal` on the handshake, the only part of this that a client gets today"
  - "[code://packages/server/src/commands/run.ts#L1267-L1277](../../../../packages/server/src/commands/run.ts#L1267-L1277) - where the daemon registers the token methods when it has a users directory"
  - "[code://docs/sdk/USERS.md#L327-L360](../../../../docs/sdk/USERS.md#L327-L360) - the token commands in the docs"
  - file:///github/ahpw/.project/plans/organization/05-a-profile-and-roles-as-pills/task-07-the-hosts-own-profile-on-me.md - the ahpw task that waits for this command, and the fields it asked for
---

## Goal

A client asks the host who its connection is, with one `x-ahpd/me` command.
The answer names the principal, its roles and grants, and the roles that the sign-in added.
It also names the minted token and the usage pools that the work goes to.
ahpw then shows a profile for a person and for the root connection, and marks the roles that a sign-in added.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "x-ahpd/me" packages .project` - nothing. ahpd has no such command.
- `rg rolesFrom packages/sdk/src` - `principalOf` adds the claim's roles to `roles`, and keeps no list of them alone.
- `rg "ahpd.principal" packages/sdk/src` - the handshake names the principal and nothing more about it.
- `rg poolsFor packages/sdk/src` - a person's pools come from `poolsFor`, and the meter charges root's work to `root:<host>`.

### Runtime path

```
client -> x-ahpd/me {} -> me method handle(params, reader, client, owner)
  person: reader -> principal, roles, rolesFromSignIn, grants (narrowed by token), token, memberships, primary, issuer, rolesFrom, pools
  root:   owner root:<host> -> principal, roles [], grants [*:*], pools [root:<host>]
  nobody: -32007
```

### Gaps

- `Principal` does not keep the roles that the sign-in added apart from the record's roles.
- No command answers a connection's grants, token, memberships or pools.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The command is `x-ahpd/me`, takes no params and answers one `Me` object | ahpw organization/05 task 07, 2026-10-21 | 02 |
| `Me` holds `principal`, `kind` (`user` or `root`), `id`, `roles`, `rolesFromSignIn`, `grants`, `token`, `pools` and, for a person, `memberships`, `primary`, `issuer` and `rolesFrom` | ahpw organization/05 task 07, 2026-10-21 | 02 |
| `roles` is the record's roles and the sign-in's roles; `rolesFromSignIn` is the sign-in's roles alone | ahpw organization/05 task 07, 2026-10-21 | 01, 02 |
| `Principal` gets `rolesFromSignIn`, stamped at sign-in as `roles` is | `(defaulted: the claim is read once at sign-in, so only the principal knows it)` | 01 |
| `grants` is what the connection may do now: the roles' grants, narrowed to the token's grants for a minted token | [code://packages/sdk/src/access/users.ts#L1091-L1110](../../../../packages/sdk/src/access/users.ts#L1091-L1110) | 02 |
| Root's `grants` is `['*:*']`, and its `roles` is empty | `(defaulted: root holds every grant, and ahpw matches *:* already)` | 02 |
| `pools` is `poolsFor` for a person and `['root:<host>']` for root | [code://packages/sdk/src/usage/meter.ts#L203-L211](../../../../packages/sdk/src/usage/meter.ts#L203-L211) | 02 |
| `issuer` and `rolesFrom` are the record's own, as written, and absent when the record has none | `(defaulted: the host's default issuer is a host setting, not the person's)` | 02 |
| Every signed-in connection may call it, a minted token too, with no grant | `(defaulted: it answers only about the caller, as the token methods let a reader in for their own tokens)` | 02 |
| A connection that names nobody is refused with `-32007` | `(defaulted: there is nobody to answer about)` | 02 |
| A host with no users directory serves no `x-ahpd/me` | [code://packages/server/src/commands/run.ts#L1267-L1277](../../../../packages/server/src/commands/run.ts#L1267-L1277) | 02 |
| `@ahpd/sdk` exports the `Me` type | ahpw organization/05 task 07, 2026-10-21 | 02 |
| A plugin's own connection is answered: `kind` `plugin`, the `grants` of its configuration entry, and `pools` `['plugin:<name>']` | Softov, 2026-10-31: "Answer it, fixed" | 02 |

## Proposed architecture

- **Data flow** - the method reads the reader's principal, or the owner for root, and the directory resolves the grants.
- **State flow** - nothing is stored. `rolesFromSignIn` is stamped on the principal at sign-in.
- **Layer responsibilities** - sdk `access/users.ts`: the stamped roles · sdk `access/me.ts`: the command · server `run.ts`: the registration · docs: the command.
- **Source-of-truth files** - `packages/sdk/src/access/me.ts`, created by task 02.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The principal keeps the sign-in's roles](task-01-the-principal-keeps-the-sign-in-roles.md) | done | - |
| [02 - x-ahpd/me answers who the connection is](task-02-x-ahpd-me-answers-the-connection.md) | done | 01 |
| [03 - The docs name x-ahpd/me](task-03-the-docs-name-x-ahpd-me.md) | done | 02 |

## Risks and tradeoffs

- `grants` is a list now, and a role change after the call is not in it. ahpw asks again when it opens the profile.
- Root's `['*:*']` is a wildcard and not the list of every grant. A client that shows grants one by one has to read `*:*` as all.

## Resume state

- **Done so far:** drafted 2026-10-28 from ahpw organization/05 task 07, against main `dfe7d9ce`. Tasks 01 to 03 are implemented on 2026-10-28; see [implemented.md](implemented.md). PR #172 merged the answer to a plugin's own connection on 2026-10-31, as `44d90a59`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the principal is frozen in `principalOf`, so `rolesFromSignIn` must be frozen with the literal, as `roles` is.

## Final verification checklist

- [ ] A person who signs in through an issuer with `rolesFrom` gets the claim's roles in `roles` and in `rolesFromSignIn`.
- [ ] A minted token with a subset of grants gets that subset in `grants`, and its id in `token`.
- [ ] The root connection gets `root:<host>`, `['*:*']` and the `root:<host>` pool.
- [ ] The handshake lists `x-ahpd/me` under `_meta['ahpd.methods']`.
- [ ] The docs name the command and its answer.
