---
title: A record names its own issuer, and the record lists them all
status: done
depends: []
layer: packages/sdk, packages/server
refs:
  - "[code://packages/sdk/src/types/users.ts#L84-L101](../../../../packages/sdk/src/types/users.ts#L84-L101) - `UserRecord.issuer`"
  - "[code://packages/sdk/src/users.ts#L130-L146](../../../../packages/sdk/src/users.ts#L130-L146) - `FileUserOptions.issuer` and `issuerFor`"
  - "[code://packages/sdk/src/users.ts#L185-L205](../../../../packages/sdk/src/users.ts#L185-L205) - the adapter cache and `issuerNameOf`"
  - "[code://packages/sdk/src/users.ts#L256-L296](../../../../packages/sdk/src/users.ts#L256-L296) - `knownIssuers` and `advertised`"
  - "[code://packages/sdk/src/issuers.ts#L146-L176](../../../../packages/sdk/src/issuers.ts#L146-L176) - `issuerKind` and `issuerFrom`"
  - "[code://packages/server/src/main.ts#L620-L660](../../../../packages/server/src/main.ts#L620-L660) - the daemon"
  - "[code://test/users-issuer.test.ts](../../../../test/users-issuer.test.ts) - the per-record cases"
---

## Objective

A record with an `issuer` signs in through that provider, a record without one signs in through the host's default, and the record a client is told lists every provider with the union of their scopes. One rule turns a name into a provider, and both the configuration and the file use it.

## Files

- `UPDATE: packages/sdk/src/types/users.ts` - `UserRecord.issuer`.
- `UPDATE: packages/sdk/src/issuers.ts` - `IssuerKind`, `issuerKind` and `issuerFrom`, the one place a name becomes a provider.
- `UPDATE: packages/sdk/src/users.ts` - `FileUserOptions.issuer` as a name and `issuerFor` as the resolver; an adapter cache; `issuerNameOf`; `knownIssuers`; an `advertised()` that composes the record on every read; a `verify` that offers a token to each issuer a record names; a `list` that reports the issuer; `signInRecord` taking any number of issuers and unioning their scopes.
- `UPDATE: packages/sdk/src/index.ts` - export `issuerFrom`, `issuerKind` and `IssuerKind`.
- `UPDATE: packages/server/src/config.ts` - `namedIssuer` is the SDK's rule rather than a second copy.
- `UPDATE: packages/server/src/main.ts` - pass the issuer name, build the advertised record without the host issuer so the directory can fill it, and print the issuer in `user list`.
- `UPDATE: test/users-issuer.test.ts` - the per-record cases, and the existing cases moved to the name form.
- `UPDATE: docs/USERS.md`, `docs/DAEMON.md` - the default, the field, the advertised list and how to try two at once.

## Steps

1. Add `UserRecord.issuer` and keep it through the file's read and write, so `add`, `mint` and `remove` do not drop it.
2. Add `issuerKind`/`issuerFrom` to `issuers.ts` and make `namedIssuer` in the daemon delegate, so one rule serves the configuration and the file.
3. Change `FileUserOptions.issuer` to the name and add `issuerFor`, defaulting to `issuerFrom`, with an adapter cache keyed by name.
4. Resolve each record's effective name as its own `issuer` or the host's, and report a name that resolves to nothing once.
5. Build the advertised record from every name the host answers for, as a getter so it follows the file, with the union of the scopes.
6. In `verify`, after no minted secret matched, offer the token to the default and then to each record's issuer, and match the subject only against the records that name that issuer.
7. Report the effective issuer in `list` and print it in `ahpd user list`.
8. Cover it: two providers on one host, the default not standing in for a record that names its own, the advertised list, the file round-trip, and a bad name.

## Validation

- `test/users-issuer.test.ts` - 18 cases, no network: a record's own issuer, the host default for the rest, the host default refused for a record that names its own, the advertised providers and scopes, the issuer kept through `mint` and `add`, and a bad name reported once.
- `test/users.test.ts`, `test/users-gate.test.ts`, `test/users-host.test.ts`, `test/listen-identity.test.ts`, `test/daemon.test.ts` - unchanged and green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- By hand: two dev issuers on 9311 and 9312, `ana` naming 9311, `sam` naming 9312, `soft` naming none and the daemon defaulting to 9311. `ana` and `soft` read a file, `sam` was refused `file:read` as a `guest`, a token no record names was refused `-32007`, and the advertised record listed both providers.

## Resume

Done 2026-09-23.
`FileUserOptions.issuer` is a name and `issuerFor` resolves it; a record's `issuer` wins and the host's is the default; the advertised record lists every provider with the union of the scopes and is read fresh each time; `verify` offers a token to each issuer in turn; `user list` prints the issuer.
Verified by the suite above, by `signInRecord(a, b)` naming both providers, and by hand with two dev issuers as described in Validation.
