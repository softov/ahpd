---
title: An issuer vouches for a person, and the directory still decides what they may do - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/users.ts
  - code://packages/sdk/src/issuers.ts
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/index.ts
  - code://packages/server/src/config.ts
  - code://packages/server/src/main.ts
  - code://test/users-issuer.test.ts
  - code://test/daemon.test.ts
  - code://docs/USERS.md
  - code://docs/DAEMON.md
  - code://.project/research/a-host-level-protected-resource.md
---

A deployment can name an authorization server, the host advertises it in `authorization_servers`, and a client that only acquires tokens through an OAuth provider has a provider to resolve.
The directory still holds the roles: the issuer answers who a token belongs to and a record's `id` is that subject, so one file says who may do what whether the credential was minted here or somewhere else.
A deployment that mints secrets keeps working exactly as it did, because the local hash is checked first.

## What was built

- `code://packages/sdk/src/types/users.ts` - `Issuer`: an RFC 8414 identifier, the scopes to ask for, and `subject(token)`, with the subject matched against a record's `id`.
- `code://packages/sdk/src/issuers.ts` - `githubIssuer`, `oidcIssuer`, the narrow `Fetcher` they take so a test needs no network, and one `get` that answers nothing rather than throwing.
- `code://packages/sdk/src/users.ts` - `FileUserOptions.issuer`, the branch in `verify` that asks it only when no local hash matched, and `signInRecord(resource, issuer?)` carrying `authorization_servers` and `scopes_supported`.
- `code://packages/server/src/config.ts` - the `issuer` key and `namedIssuer`, which accepts `github` or an https URL and nothing else.
- `code://packages/server/src/main.ts` - `--issuer`, the configuration merge, the issuer built once beside the directory, the record composed with it, and a startup line that names it.
- `code://docs/USERS.md`, `code://docs/DAEMON.md` - the issuer, the record it produces, the key and the flag.
- `code://.project/research/a-host-level-protected-resource.md` - the protocol gap behind advertising a host-wide login on every agent.

## Verified

- `pnpm test`: 72 files, 929 tests, up from 71 and 917. `test/users-issuer.test.ts` is new with nine cases and no network; `test/daemon.test.ts` gained `namedIssuer`.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand against a real daemon on `--issuer github`: the record carried `authorization_servers: ["https://github.com/login/oauth"]` and `scopes_supported: ["read:user"]`; a bogus token answered `-32007 That credential is not one this host knows`; and a minted secret authenticated and reached `listSessions`.
- The 401 for that bogus token was confirmed directly against `api.github.com`, so the refusal was GitHub's and not an unreachable network.

## Departures from the plan

- Task 01 - the decision named an `Issuer` verifier rather than another implementation of the `Users` port, because one file already holds both the roles and the local secrets. The plan was amended by the decision before the task was built.
- Task 02 - the plan expected a hand check with a token GitHub would refuse; it was run against the real endpoint, which answered, so the case is a refusal rather than a fail-closed fallback.
- Task 03 - the plan listed a JWT verifier as a non-goal and a key-set verifier as deferred, which is what `deferred.md` says.

## Left for later

- Local JWT verification against the issuer's key set, roles from issuer claims or groups, and an issuer's token at the connection token - see [deferred.md](deferred.md).
- A host-level protected resource in AHP, so a host-wide login stops riding on every agent - see `.project/research/a-host-level-protected-resource.md`.
