---
title: Loopback over http, and an issuer to test with
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/issuers.ts#L89-L115](../../../../packages/sdk/src/issuers.ts#L89-L115) - where `isIssuerUrl` and the endpoint check go"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - `namedIssuer`"
  - "[code://test/users-issuer.test.ts](../../../../test/users-issuer.test.ts) - the loopback and remote cases"
  - "[code://test/daemon.test.ts](../../../../test/daemon.test.ts) - `namedIssuer`"
---

## Objective

`http://127.0.0.1:9310` is a usable issuer, `http://idp.test` is not, `scripts/dev-issuer.mjs` runs an issuer to point at, and the docs say how to try the option.

## Files

- `UPDATE: packages/sdk/src/issuers.ts` - `loopbackUrl`, `isIssuerUrl`, and the discovered endpoint checked by it.
- `UPDATE: packages/sdk/src/index.ts` - export `isIssuerUrl`.
- `UPDATE: packages/server/src/config.ts` - `namedIssuer` uses `isIssuerUrl`.
- `CREATE: scripts/dev-issuer.mjs` - discovery and userinfo over http on loopback, any bearer token answering as its own subject.
- `UPDATE: test/users-issuer.test.ts`, `test/daemon.test.ts` - the loopback and remote cases, and `isIssuerUrl`.
- `UPDATE: docs/USERS.md`, `docs/DAEMON.md` - what an issuer must publish, the loopback rule, and the three ways to try one.

## Steps

1. Write `loopbackUrl` for `127.0.0.1`, `[::1]` and `localhost`, and `isIssuerUrl` as https anywhere plus http on loopback.
2. Check the discovered `userinfo_endpoint` with it instead of the https prefix.
3. Have `namedIssuer` use it, so the configuration and the discovery agree.
4. Write `scripts/dev-issuer.mjs`: a discovery document naming its own userinfo endpoint, and a userinfo that answers `sub` as the bearer token it was given.
5. Document what an issuer must publish, the loopback rule, the self-signed case, and the three ways to try it.

## Validation

- `test/users-issuer.test.ts` - a loopback http endpoint resolves a subject; a remote http one is refused; `isIssuerUrl` accepts the three loopback spellings and refuses remote http, a fragment and a bare word.
- `test/daemon.test.ts` - `namedIssuer` accepts loopback http and refuses remote http.
- By hand: `scripts/dev-issuer.mjs 9310` and a daemon on `--issuer http://127.0.0.1:9310`, a `guest` record with id `ana`, and `authenticate` with the token `ana` accepted, with `listSessions` served and `resourceRead` refused.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
Loopback is allowed over http in both the configuration and the discovered endpoint; `scripts/dev-issuer.mjs` is two endpoints and verifies nothing; the docs say what an issuer must publish and the three ways to try one.
Verified by hand as above: the record carried `authorization_servers: ["http://127.0.0.1:9310"]`, `authenticate` with `ana` was accepted through the dev issuer, `listSessions` was served for the `guest`, and `resourceRead` was refused `file:read`.
