---
title: An issuer answers for a subject
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/types/users.ts#L43-L62](../../../../packages/sdk/src/types/users.ts#L43-L62) - `UserRecord`, whose `id` becomes the subject, and where `Issuer` is declared"
  - "[code://packages/sdk/src/users.ts#L148-L175](../../../../packages/sdk/src/users.ts#L148-L175) - `verify`, which gains the branch and keeps the hash compare first"
  - "[code://packages/sdk/src/users.ts#L29-L70](../../../../packages/sdk/src/users.ts#L29-L70) - `signInRecord` and `FileUserOptions`, which take the issuer"
  - "[code://packages/sdk/src/github.ts](../../../../packages/sdk/src/github.ts) - a port implementation that already reaches the network from this package, so the shape is established"
  - https://www.rfc-editor.org/rfc/rfc8414 - the metadata document an OpenID Connect issuer publishes at its well-known path
---

## Objective

A token this host did not mint can be checked: an `Issuer` answers who it belongs to, `fileUsers` maps that subject to a record, and the roles are resolved exactly as they are for a locally minted secret.

## Files

- `CREATE: packages/sdk/src/issuers.ts` - `githubIssuer` and `oidcIssuer`, and the one `get` they share.
- `UPDATE: packages/sdk/src/types/users.ts` - `Issuer`: an identifier, the scopes to ask for, and `subject(token)`.
- `UPDATE: packages/sdk/src/users.ts` - `FileUserOptions.issuer`, `signInRecord` carrying `authorization_servers` and `scopes_supported`, and the issuer branch in `verify`.
- `UPDATE: packages/sdk/src/index.ts` - export `githubIssuer`, `oidcIssuer` and the `Issuer` type.
- `CREATE: test/users-issuer.test.ts` - the verifier and the branch, against a fake fetch.

## Steps

1. Declare `Issuer` next to `Users` in `types/users.ts`: `id`, `scopes`, and `subject(token): Promise<string | undefined>`, with the comment saying the subject is matched against a record's `id` and that nothing is the answer for a token nobody owns.
2. Write `issuers.ts` with one `get(fetcher, url, token?)` that sends `Authorization: Bearer` only when there is a token, requires `answer.ok`, parses JSON, and answers `undefined` on any failure rather than throwing.
3. `githubIssuer(options)`: `id` defaults to `https://github.com/login/oauth`, the endpoint to `https://api.github.com/user`, the scopes to `['read:user']`, and the subject is `login` when it is a non-empty string.
4. `oidcIssuer(options)`: `id` is the issuer it was given, the scopes default to `['openid']`, the userinfo endpoint is discovered once from `<issuer>/.well-known/openid-configuration` and cached only on success, and it must be https or the issuer answers nobody. The subject is `sub`.
5. In `fileUsers`, take the issuer from the options: `verify` keeps the hash compare first and asks the issuer only when nothing matched, and a matched subject must be a record's `id`.
6. Have `signInRecord(resource, issuer?)` add `authorization_servers: [issuer.id]` and `scopes_supported` when an issuer is given, and have the options' fallback record go through it.
7. Write `test/users-issuer.test.ts`: a GitHub-shaped token resolves to the record whose id is the login; a login nobody has a record for is nobody; a locally minted secret still verifies with an issuer configured and the issuer is not asked for it; a token the issuer refuses is nobody; an issuer that cannot be reached is nobody and does not throw; `oidcIssuer` discovers the endpoint once for two tokens and refuses an http one; `signInRecord` with an issuer carries the identifier and the scopes.

## Validation

- `test/users-issuer.test.ts` - the cases in step 7, with a fake `fetch` and no network.
- `test/users.test.ts` unchanged and green, which is the proof that a directory with no issuer did not move.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
`Issuer` is declared beside `Users`; `githubIssuer` and `oidcIssuer` live in `packages/sdk/src/issuers.ts` behind one narrow `Fetcher` and one `get` that answers nothing rather than throwing; `fileUsers` takes an `issuer` and asks it only when no local hash matched, matching the subject against a record's `id`; and `signInRecord(resource, issuer?)` carries `authorization_servers` and `scopes_supported`.
`test/users-issuer.test.ts` holds nine cases against a fake fetch and no network.
Found: OpenID Connect discovery is fetched once and kept only on success, so a failed discovery is retried on the next sign-in, and a `userinfo` endpoint that is not https is refused before any token is sent.

