---
title: The daemon names one
status: done
depends:
  - task-01-an-issuer-answers-for-a-subject.md
layer: packages/server
refs:
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the keys, beside which `issuer` goes, and where a value is turned into a named issuer"
  - "[code://packages/server/src/main.ts#L542-L590](../../../../packages/server/src/main.ts#L542-L590) - the directory and the record, which is where the issuer is read"
  - "[code://packages/server/src/main.ts#L475-L500](../../../../packages/server/src/main.ts#L475-L500) - the flags an operator reads, and the startup line that now names the issuer"
---

## Objective

An operator writes `"issuer": "github"` or an issuer URL, or passes `--issuer`, and the host advertises that issuer and accepts its tokens while the same file still decides the roles.

## Files

- `UPDATE: packages/server/src/config.ts` - the `issuer` key, and `namedIssuer(value)` answering `github`, an https issuer, or nothing.
- `UPDATE: packages/server/src/main.ts` - `Options.issuer`, the `--issuer` flag, the configuration merge, the record composed with the issuer, and the help text.
- `UPDATE: test/daemon.test.ts` - `namedIssuer`, including the values it refuses.
- `UPDATE: docs/DAEMON.md` - the `issuer` key and what each form means.

## Steps

1. Add `issuer?: string` to `Config`, documented as `github` or an https OpenID Connect issuer.
2. Write `namedIssuer(value)` in `config.ts`: `'github'` answers the preset, an https URL with no fragment answers an OpenID Connect issuer, and anything else answers nothing so the caller refuses the start with a sentence rather than the host discovering it later.
3. In `main.ts`, build the issuer once beside the directory, so the record and the port take the same value, and refuse an unreadable one through `stop`.
4. Compose the record with `signInRecord(advertisedResource(), issuer)` so `authorization_servers` and `scopes_supported` are on it exactly when an issuer is configured.
5. Add `--issuer <github|url>` to the usage text and the key to the list of configuration keys, and add the issuer to the startup line beside `sign-in`, so an operator sees which one a client will be told.
6. Test `namedIssuer`: `github`, an https issuer, and the refusals - `http://`, a bare word, a fragment.

## Validation

- `test/daemon.test.ts` - the cases in step 6.
- By hand: a daemon with `--issuer github` and a user file whose record id is a GitHub login, and an `authenticate` with a token GitHub would refuse answers `-32007` rather than an internal error.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
`Config.issuer` and `Options.issuer`, `namedIssuer` in `config.ts` (`github` or an https URL and nothing else), the `--issuer` flag and the key, the record composed with the issuer, and a startup line that names it. `test/daemon.test.ts` covers `namedIssuer`, including what it refuses.
Verified by hand against a real daemon on `--issuer github`: the record carried `authorization_servers: ["https://github.com/login/oauth"]` and `scopes_supported: ["read:user"]`, a token GitHub answered 401 for became `-32007 That credential is not one this host knows`, and the minted secret still authenticated and reached `listSessions`.
The 401 was checked directly against `api.github.com`, so that case was a refusal and not an unreachable network.

