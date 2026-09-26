---
title: "`ahpd` keeps its own user directory"
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/sessions.ts](../../packages/sdk/src/sessions.ts) - `fileSessions`, the shape a file-backed port takes in this SDK"
  - "[code://packages/server/src/config.ts](../../packages/server/src/config.ts) - the daemon config the user file sits beside, and where its path is named"
  - "[code://packages/server/src/main.ts#L461](../../packages/server/src/main.ts#L461) - where a host-level port is handed to `createHost`"
  - https://datatracker.ietf.org/doc/html/rfc9728 - the metadata format the advertised resource follows, whoever issues the credential
---

## Context

[A person signs in through `authenticate`](a-person-signs-in-through-authenticate.md) settles how a credential reaches the host and leaves open who issues it and who says it is good.
Two answers work.
The host can be its own issuer, minting opaque tokens against a file it owns, or `authorization_servers` can name a real identity provider and the host can validate a JWT against its keys.

The case that motivated this is one `ahpd` on a LAN with a few people on it, where standing up Authentik or Keycloak to decide whether somebody may open a terminal is more infrastructure than the thing it protects.

## Decision

`ahpd` holds its own user directory: a file beside the daemon config with one record per person, each carrying an id, a set of roles and a hashed token.
New CLI verbs add a person, remove one, list them and mint a token, and a minted token is shown once and stored only as a hash.
No external identity provider is contacted, and the host works with no network beyond the one it is serving.

Verification sits behind a `Users` port, so the file-backed implementation is one of potentially several and the enforcement layer never learns where a principal came from.

Source: the user, 2026-09-23, asked who issues and verifies the credential and chose "ahpd's own directory".

## Consequences

A daemon with no user file configured has no user directory, and every gate this plan adds is inert. That is what keeps every existing install and every existing test unchanged.

The advertised RFC 9728 record still names an `authorization_servers` entry, because the field is required by the format and clients read it to know where to go. For a self-issued credential it points at the host's own documentation rather than at an OAuth endpoint, and a client that tries to run a real OAuth flow against it will fail. That is the one place where being one's own issuer shows through the standard shape.

Tokens are opaque and high entropy, so they are stored as a SHA-256 hash and compared in constant time. They are not passwords and must not be run through a password hash: the cost buys nothing against a 256-bit random value and only slows every connection.

The port is the seam an identity provider arrives through later. `ahp-server`'s master can implement the same interface when it mints route tickets, which is the reason it is a port rather than a function.

## Options

- **An external identity provider now.** Right for the hosted and enterprise case, and the answer `ahp-server` will eventually want. Rejected for this plan: it needs JWKS fetching, clock skew handling and a scope-to-capability mapping, and it cannot work on a disconnected LAN, which is the case that asked for this.
- **Own directory with no seam, an identity provider as a rewrite later.** Cheaper now by about one interface, and it would put the rewrite through the enforcement layer rather than beside it.
