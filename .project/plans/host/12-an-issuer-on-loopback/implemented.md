---
title: An issuer may be plain http on loopback - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/issuers.ts
  - code://packages/sdk/src/index.ts
  - code://packages/server/src/config.ts
  - code://scripts/dev-issuer.mjs
  - code://test/users-issuer.test.ts
  - code://test/daemon.test.ts
  - code://docs/USERS.md
  - code://docs/DAEMON.md
---

A local issuer over plain http now works, so an operator can name one on the same machine without a certificate. A remote issuer still needs TLS, and a discovered `userinfo` endpoint is checked again so an issuer cannot name a remote http one and have a token sent to it.

## What was built

- `code://packages/sdk/src/issuers.ts` - `loopbackUrl` and `isIssuerUrl`, and the discovered endpoint checked by the latter.
- `code://packages/server/src/config.ts` - `namedIssuer` accepts what `isIssuerUrl` accepts.
- `code://scripts/dev-issuer.mjs` - an issuer in one file: discovery, and a userinfo that answers any bearer token as its own subject. Binds loopback, verifies nothing, documented as a test double.
- `code://docs/USERS.md` - what an issuer must publish, the loopback rule, the self-signed case, and the three ways to try one.
- `code://docs/DAEMON.md` - the same rule at the `issuer` key.

## Verified

- `test/users-issuer.test.ts` and `test/daemon.test.ts` - loopback accepted, remote http refused, `isIssuerUrl` refusing a fragment and a bare word.
- By hand: `node scripts/dev-issuer.mjs 9310`, a daemon on `--issuer http://127.0.0.1:9310 --without-connection-token`, a record `ana (guest)`, and `authenticate` with the token `ana` accepted through the issuer. `listSessions` was served and `resourceRead` refused `ana may not file:read here`.

## Departures from the plan

- None. The check lives in the SDK so the configuration and the discovery use one function rather than two prefix tests.

## Left for later

- Nothing. Verifying a JWT against a key set is still deferred by plan 08, which is unrelated to which schemes this host will fetch over.
