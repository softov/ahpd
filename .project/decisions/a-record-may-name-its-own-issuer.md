---
title: A record may name its own issuer, and the host's issuer is the default
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/types/users.ts#L84-L101](../../packages/sdk/src/types/users.ts#L84-L101) - `UserRecord.issuer`, the field this adds"
  - "[code://packages/sdk/src/users.ts#L130-L146](../../packages/sdk/src/users.ts#L130-L146) - `FileUserOptions.issuer` as a name, and `issuerFor` as the resolver"
  - "[code://packages/sdk/src/users.ts#L185-L205](../../packages/sdk/src/users.ts#L185-L205) - the adapter cache and `issuerNameOf`, which is the whole of the rule"
  - "[code://packages/sdk/src/users.ts#L256-L296](../../packages/sdk/src/users.ts#L256-L296) - `knownIssuers` and `advertised`, which put every provider on the record"
  - "[code://packages/sdk/src/issuers.ts#L146-L176](../../packages/sdk/src/issuers.ts#L146-L176) - `issuerKind` and `issuerFrom`, one rule for a configuration and a record"
  - "[code://packages/server/src/config.ts#L239-L252](../../packages/server/src/config.ts#L239-L252) - `namedIssuer`, now the same rule"
  - "[code://docs/USERS.md](../../docs/USERS.md) - the operator's side, which this changes"
---

## Context

The `issuer` option named one authorization server for the whole host, and every record was matched against that one subject.
That is the common case and it is what [host/08](../plans/host/08-an-issuer-behind-the-users-port/plan.md) built.

It stops being enough as soon as two people arrive through two providers: a GitHub login for one and a company identity provider for another.
Today the second person needs a second daemon on another port, which is a second host to configure, to sign in to and to reach.

The file already says which roles a person holds and whether their token authorizes them, so it is where the one remaining fact about a person belongs.

## Decision

A record may name its own `issuer`, using the same names the configuration takes: `github`, or an issuer URL this host may reach.
The configuration's `issuer` is the default for every record that names none, and a host that names neither is reached by minted secrets alone.

The advertised record lists every provider the host answers for, the default and each record's own, because that list is what a client resolves a provider from.
`scopes_supported` is the union of theirs.

A name that is neither `github` nor a reachable URL is reported once and never verifies, the way a grant that is not `<subject>:<verb>` is reported and dropped, because a file is a thing a person edits.

A token that matched no minted secret is offered to the default first and then to each issuer a record names, and the first subject that names a record wins: which provider minted a token is not something the token says.

## Consequences

Two people on one host can sign in through two providers, which is what the feature is for.
A host with one issuer and no record naming another behaves exactly as it did, and a host with no issuer is unchanged.
The record a client is told becomes a function of the file rather than a constant, so editing the file is enough and no restart is needed.
A token that belongs to no record is now shown to every issuer in turn, which is a real leak of a meaningless string and the cost of not knowing the provider up front; it is bounded by asking only the issuers a record actually names.
A record's `issuer` is written by hand: `ahpd user add` does not take one, and `add`, `mint` and `remove` preserve what is there.

## Options

- **Keep one issuer for the whole host.** Rejected: the second provider then needs a second daemon, and the file already exists to say per-person facts.
- **A record's issuer replaces the host's, with no default.** Rejected: everyone through one provider is the common case, and writing the same issuer on every record is the thing a default is for.
- **Ask only the issuers that records name, never the host default.** Rejected: the default is a configured way in even before a record falls back to it, so it is advertised and asked like any other.
- **Verify a JWT locally against each issuer's key set to tell them apart first.** Rejected for now: GitHub issues opaque tokens, so the `userinfo` question is one code path where key sets are several, and the deferred item in [host/08's deferred.md](../plans/host/08-an-issuer-behind-the-users-port/deferred.md) already covers doing it later.
