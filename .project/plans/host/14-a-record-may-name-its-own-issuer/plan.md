---
title: A record may name its own issuer
domain: host
status: built
priority: medium
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/host/08-an-issuer-behind-the-users-port/plan.md
  - plans/host/12-an-issuer-on-loopback/plan.md
changes: []
creates: []
decisions:
  - decisions/a-record-may-name-its-own-issuer.md
refs:
  - "[code://packages/sdk/src/types/users.ts#L84-L101](../../../../packages/sdk/src/types/users.ts#L84-L101) - `UserRecord.issuer`"
  - "[code://packages/sdk/src/users.ts#L130-L146](../../../../packages/sdk/src/users.ts#L130-L146) - `FileUserOptions.issuer` as a name, and `issuerFor`"
  - "[code://packages/sdk/src/users.ts#L256-L296](../../../../packages/sdk/src/users.ts#L256-L296) - `knownIssuers` and `advertised`"
  - "[code://packages/sdk/src/issuers.ts#L146-L176](../../../../packages/sdk/src/issuers.ts#L146-L176) - `issuerKind` and `issuerFrom`"
  - "[code://packages/server/src/main.ts#L620-L660](../../../../packages/server/src/main.ts#L620-L660) - the daemon, which passes the name and not the adapter"
  - "[code://test/users-issuer.test.ts](../../../../test/users-issuer.test.ts) - the per-record cases"
---

## Goal

One host can sign two people in through two providers. A record names its own `issuer` with the same names the configuration takes, the configuration's `issuer` is the default for the records that name none, and the advertised record lists every provider so a client can resolve one.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "issuer" packages/sdk/src packages/server/src` - one adapter built in the daemon and handed to `fileUsers`, so per-record issuers need a name-to-adapter resolver rather than another option.
- `rg -n "options.users.resource" packages/sdk/src/host.ts` - read on every agent listing, not cached, so a getter is enough for the record to follow the file.
- `rg -n "isIssuerUrl" packages/sdk/src packages/server/src` - the URL rule was in the SDK and the `github`/URL rule in the daemon, which is two rules for one vocabulary and had to become one.

### Gaps

- The file had no field for a person's provider, so the second provider meant a second daemon.
- `FileUserOptions.issuer` took an `Issuer`, which cannot come from a file the directory reads on every question.
- `authorization_servers` was built once from the host's issuer, so a per-record provider was unrepresentable and a client could not resolve it.
- `ahpd user list` could not say where a record signs in.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A record may name its own issuer, and the host's issuer is the default](../../../decisions/a-record-may-name-its-own-issuer.md) | The user, 2026-09-23: "ok do the pending 3. So I can test better...", naming what `HANDOFF.md` listed as "an issuer per record with the host's `issuer` as the default". |

| What | Source | Task |
| --- | --- | --- |
| The record lists every provider, with the union of the scopes | decision 1 | 01 |
| A name neither `github` nor a reachable URL is reported once | decision 1 | 01 |
| A token is offered to each issuer in turn, the default first | decision 1 | 01 |
| `ahpd user add` does not take an issuer | decision 1 | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A record names its own issuer, and the record lists them all](task-01-a-record-names-its-own-issuer.md) | done | - |

## Risks and tradeoffs

- A token that belongs to no record is shown to every issuer a record names, in turn.
  The mitigation is that only issuers a record actually names are asked, the order is the host's default first, and a matched secret never leaves the host.
- The advertised record now follows the file, so it can change while a client is connected.
  The mitigation is that a client re-reads the agent list on a subscription, and a record that stopped being true is worse than one that changed.
- A record's `issuer` is only writable by hand.
  The mitigation is `ahpd user list` printing it, and `add`, `mint` and `remove` preserving it rather than dropping it.
- `scopes_supported` is the union, so one provider may be asked for a scope it does not know.
  The mitigation is that a client resolves the provider it has and asks what that provider wants; the union is there because the field is flat.

## Resume state

- **Done so far:** the task, 2026-09-23. A record names its own issuer, the host's is the default, the record lists every provider, and the tests and docs say so. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Does a record's issuer replace the host default for that record? - answered by decision 1: yes, and the host's is only what a record that names none gets.
  2. Is the default issuer advertised when no record names it? - answered by decision 1: yes, it is a configured way in.
- **Watch out for:** `FileUserOptions.issuer` is a name, not an `Issuer`, and `issuerFor` is the seam a test injects to avoid the network. The change of type is the guard: a caller still passing an adapter is a compile error rather than a runtime surprise.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] `test/users-issuer.test.ts` - a record's own issuer answers for it, the host default answers for the records that name none, the host default cannot stand in for a record that names its own, the advertised record lists both providers with the union of scopes, and a bad name is reported once.
- [x] The existing issuer cases still pass with `issuer: 'github'` and an injected `issuerFor`.
- [x] By hand: two dev issuers, one record naming each and one falling back to the host default. See [implemented.md](implemented.md).
- [x] `plans/index.md`, `docs/USERS.md`, `docs/DAEMON.md` and `working/HANDOFF.md` updated.
