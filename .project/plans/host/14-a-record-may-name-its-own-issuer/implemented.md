---
title: A record may name its own issuer - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/users.ts
  - code://packages/sdk/src/issuers.ts
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/index.ts
  - code://packages/server/src/config.ts
  - code://packages/server/src/main.ts
  - code://test/users-issuer.test.ts
  - code://docs/USERS.md
  - code://docs/DAEMON.md
---

Two people on one host can now sign in through two providers. A record names its own `issuer` with the same names the configuration takes, the configuration's `issuer` is what a record that names none gets, and the record a client is told lists every provider the file uses.

## What was built

- `code://packages/sdk/src/types/users.ts` - `UserRecord.issuer`, the same vocabulary as the configuration's key.
- `code://packages/sdk/src/issuers.ts` - `IssuerKind`, `issuerKind` and `issuerFrom`: one place that turns `github` or a URL into a provider, so a configuration and a record cannot disagree.
- `code://packages/sdk/src/users.ts` - `FileUserOptions.issuer` is a name and `issuerFor` resolves a record's own, with an adapter built and kept once per name. `issuerNameOf` is the effective provider, `knownIssuers` collects them, and `advertised()` composes the record on every read so editing the file is enough. `verify` offers a token that matched no minted secret to the host's default and then to each record's issuer, matching a subject only against the records that name that provider. `list` reports the effective issuer. `signInRecord` takes any number of providers and unions their scopes.
- `code://packages/sdk/src/index.ts` - `issuerFrom`, `issuerKind` and `IssuerKind` exported.
- `code://packages/server/src/config.ts` - `namedIssuer` delegates to `issuerKind`, so the daemon's key and a record's field are one rule.
- `code://packages/server/src/main.ts` - the daemon passes the issuer name, builds the advertised record without an issuer so the directory fills it, and prints the issuer in `user list`.
- `code://docs/USERS.md` - an issuer per person, the advertised list, and two issuers tried at once with the dev issuer.
- `code://docs/DAEMON.md` - the `issuer` key as the default for records, and that the record lists every provider.

## Verified

- `test/users-issuer.test.ts`, 18 cases with no network. New: a record's own issuer answers for it while the host's answers for the records that name none; the host's issuer answering a subject that belongs to a record naming another is refused; the advertised record lists both providers with the union of the scopes; a record's issuer survives `mint` and `add`; a name that is neither `github` nor a reachable URL is reported once and advertised nowhere. `signInRecord` with two providers names both and unions `read:user` with `openid`.
- `test/users.test.ts`, `test/users-gate.test.ts`, `test/users-host.test.ts`, `test/listen-identity.test.ts`, `test/daemon.test.ts` - unchanged and green, which is the point: a host with one issuer and a host with none behave exactly as before.
- Whole suite 72 files, 948 tests; `pnpm typecheck` and `pnpm boundary` green.
- By hand: two dev issuers on 9311 and 9312, a daemon with `--issuer http://127.0.0.1:9311` as the default and a file where `ana` names 9311, `sam` names 9312 and `soft` names none. The advertised record listed both providers with `openid`. `ana` signed in and read a file, `sam` signed in and was refused `file:read` with `-32009` as a `guest`, `soft` signed in through the default and read a file, and a token no record names was refused `-32007`. The 9311 issuer answers every token as its own subject, so `sam` matching only through 9312 is the per-record attribution working. `ahpd user list` printed each record's issuer.

## Departures from the plan

- None. The advertised record is a getter rather than a value, which the plan's reconnaissance found was safe because the host reads it per agent listing and never caches it.

## Left for later

- Verifying a JWT locally against an issuer's key set, and roles from an issuer's claims or groups, both still deferred in [host/08's deferred.md](../08-an-issuer-behind-the-users-port/deferred.md).
- `ahpd user add` does not take `--issuer`; the field is written by hand and `user list` shows it.
