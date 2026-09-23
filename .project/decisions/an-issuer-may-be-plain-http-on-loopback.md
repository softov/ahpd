---
title: An issuer may be plain http on loopback, and nowhere else
status: accepted
date: 2026-09-23
supersedes: decisions/the-issuer-option-takes-a-url-or-github.md
refs:
  - "[code://packages/sdk/src/issuers.ts#L89-L115](../../packages/sdk/src/issuers.ts#L89-L115) - `loopbackUrl`, `isIssuerUrl` and the check the discovered endpoint passes"
  - "[code://packages/server/src/config.ts](../../packages/server/src/config.ts) - `namedIssuer`, which validates what the configuration names"
  - "[code://scripts/dev-issuer.mjs](../../scripts/dev-issuer.mjs) - the two endpoints, and nothing else"
  - https://www.rfc-editor.org/rfc/rfc9728#section-7.7 - a client fetches authorization server metadata, which is the request a malicious issuer would aim
---

## Context

Decision `the-issuer-option-takes-a-url-or-github` said a discovered `userinfo` endpoint must be https, because the document is remote and a bearer token must not go out in clear.

That rule made the common case impossible: a self-hosted issuer on the same machine is usually plain http, and requiring a certificate for it means the option cannot be tried without first building a CA. The user asked to run one and could not.

The risk the rule was for is a token crossing a network, not a token crossing a loopback interface.

## Decision

An issuer URL, and the `userinfo` endpoint its metadata names, may be https anywhere, or plain http when the host is loopback: `127.0.0.1`, `[::1]` or `localhost`.
Everything else over http is refused, so a remote issuer still needs TLS.
The `github` preset and the rest of the option are unchanged, and `--resource` still requires https, because that identifier is published to clients rather than fetched by this host.

## Consequences

A local identity provider - and `scripts/dev-issuer.mjs`, which is two endpoints and verifies nothing - is usable with no certificate.
Nothing is weakened for a remote issuer, which is where a token would cross a network.
A self-signed https issuer still fails, because `fetch` has no reason to trust it; that is an environment matter and the answer is `NODE_EXTRA_CA_CERTS` rather than an option to skip verification.
The check happens twice on purpose: the configuration refuses a named issuer that is remote http, and the discovered endpoint is checked again, because the metadata is what chooses where the token actually goes.

## Options

- **Keep https-only.** Rejected: it makes the feature untestable without a certificate authority, and the threat it guards against is a network, not an interface.
- **Accept http anywhere, and document it.** Rejected: a bearer token in clear on a network is the one thing the rule was for.
- **An `insecure` flag that skips verification.** Rejected: a switch to turn off TLS checking outlives the test it was added for, and the loopback rule covers the case it would be reached for.
