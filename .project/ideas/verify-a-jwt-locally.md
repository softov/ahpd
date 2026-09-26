---
title: Verify a JWT locally, against the issuer's key set
created: 2026-09-26
---

Deferred from `host/08` ([deferred.md](../plans/host/08-an-issuer-behind-the-users-port/deferred.md)). Today an issuer's token is checked by asking its `userinfo` endpoint ([`code://packages/sdk/src/issuers.ts#L130-L157`](../../packages/sdk/src/issuers.ts#L130-L157)), once, when a connection signs in ([`code://packages/sdk/src/host.ts#L5844`](../../packages/sdk/src/host.ts#L5844)). `host/10` re-reads the users file on every command but never asks the issuer again.

When the token is a JWT, the host could check it itself: fetch the issuer's `jwks_uri` from the discovery document it already reads, keep the keys by `kid`, verify the signature, and read `iss`, `sub`, `aud` and `exp` from the token. `userinfo` stays as the path for everything else.

## What it would buy

- **The token's lifetime.** `exp` says when a sign-in stops being true. Today a connection that signed in stays signed in until it drops, however short the token was. The host could refuse the next command after `exp` with `-32007`, the same answer `host/10` gives a removed person, and the client signs in again.
- **The right issuer, directly.** `verify` asks the default issuer and then every issuer a record names, in order, until one answers ([`code://packages/sdk/src/users.ts#L403-L425`](../../packages/sdk/src/users.ts#L403-L425)). A JWT names its issuer in `iss`, so only that one is consulted, and a token from nobody known is refused without a request.
- **A sign-in while the issuer is down**, once its keys are cached. The dead issuer in Softov's own config would have kept working for tokens it had already signed.
- **One request fewer per sign-in**, which is the smallest of the four.

## What it would not do

- Nothing for GitHub, whose tokens are opaque.
- Nothing for an OpenID provider whose access tokens are opaque either; OIDC does not require them to be JWTs. `auto` below falls back to `userinfo` for those.
- It does not notice a token the provider revoked before `exp`. `userinfo` does, on the one call it makes.

## Shape

- No dependency. Node's WebCrypto verifies RS256, PS256, ES256 and EdDSA from a JWK (`crypto.subtle.importKey('jwk', …)`), and the parsing is base64url and JSON. The `alg` allowlist is those four; `none` and every `HS*` are refused, since a shared secret is not something an issuer publishes.
- Keys cached per issuer by `kid`, refetched once on an unknown `kid` and no more often than a minimum interval, so a flood of bad tokens is not a flood of requests to the issuer.
- A small clock skew allowance on `exp` and `nbf`.
- `aud` must name this host, which needs a value to compare against (see below).
- A token accepted this way gives the same `IssuerAnswer` as `userinfo`: the subject, which the users file still maps to a record and its roles.

## Open

- **Opt-in, or automatic.** A per-issuer setting such as `verify: 'userinfo' | 'jwt' | 'auto'`, where `auto` verifies a JWT locally and asks `userinfo` for anything else. `auto` as the default changes behaviour for existing deployments, because a token past `exp` stops working mid-connection.
- **The audience.** What this host expects in `aud`: its public URL, a configured string, or the client id the operator registered. RFC 9068's JWT access-token profile (`typ: at+jwt`) says the resource server checks it, and skipping the check lets a token minted for another service sign in here.
- **What `exp` does to a live connection.** Refuse the next command, or notify the client ahead of time so it can refresh first. The protocol's `-32007` path already exists; a warning ahead of it does not.
- **Claims for roles.** Once the token is read locally, the deferred "roles from the issuer's claims" becomes a claim read rather than a second request. `host/15` settled how roles come from a claim; this would only change where the claim is read from.
