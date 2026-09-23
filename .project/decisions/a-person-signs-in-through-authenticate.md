---
title: A person signs in through `authenticate`, not through the connection token
status: superseded
superseded-by: decisions/a-connection-token-may-carry-a-person.md
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/host.ts#L5118-L5185](../../packages/sdk/src/host.ts#L5118-L5185) - the `authenticate` handler, which already holds a credential per connection and is where a person's now lands"
  - "[code://packages/sdk/src/host.ts#L2011-L2014](../../packages/sdk/src/host.ts#L2011-L2014) - `resourcesOf`, which already appends a host-owned resource to every agent for GitHub"
  - "[code://packages/sdk/src/listen.ts#L45-L50](../../packages/sdk/src/listen.ts#L45-L50) - the connection token, the rejected alternative, unchanged by this decision"
  - "[code://packages/sdk/src/types/host.ts#L405-L441](../../packages/sdk/src/types/host.ts#L405-L441) - `Connection.tokens`, per connection because the specification says authentication is"
  - file:///github/externals/agent-host-protocol/docs/specification/authentication.md - the flow this follows, its error codes and its per-connection rule
---

## Context

`ahpd` has one secret and no people in it.
The connection token in `listen.ts` is compared against a single configured string, so every holder of it is the same principal, and `client_connect` records a `clientId` the client asserted for itself at `initialize` and nobody checked.
After `host/04` the connection boundary is the whole of the host's access control, which that decision states outright.

The protocol already carries a credential from a client to a host.
`AgentInfo.protectedResources` publishes RFC 9728 records in root state, `authenticate` pushes a Bearer token for one of them, `-32007` asks for one from any command, and `auth/required` says a token expired.
`ahpd` implements all of that except `-32007`, which it never throws.
Today it treats the credential as opaque and says so: the token is not verified, because the host cannot ask Anthropic whether a key is good.

The question is which of the two secrets identifies a person.

## Decision

A person's credential rides the protocol's own `authenticate` command, against a protected resource the host advertises for itself.
The host adds one RFC 9728 record to every agent's `protectedResources`, the way `resourcesOf` already appends GitHub's, and verifies a token pushed for that one resource against its own user directory.
A verified token attaches a principal to the `Connection` for the life of that connection, an empty token detaches it, and `expiresIn` detaches it on time through the `auth/required` path that already exists.
Every other resource keeps today's behaviour exactly: a backend's own credential and an MCP server's are still held unverified and passed through.

The connection token does not change and does not become per-user.
It keeps answering whether a socket may exist at all, with one shared secret, in `listen.ts`, untouched by this plan.

Source: the user, 2026-09-23, asked where a user presents their credential and chose "authenticate on `ahp-root://`" over resolving the connection token to a principal.

## Consequences

Two secrets exist where there was one, doing different jobs: the connection token is rotated per incident and the credential is revoked per person.
Removing a user does not close their socket, because they still hold the connection token; it only empties what they may do. Rotating the connection token is what locks somebody out of the door.

Root state is readable before anybody authenticates, and that is not avoidable: `protectedResources` lives in root state, so it is what tells a client how to sign in. `initialize` honours `initialSubscriptions` inline, so the root snapshot reaches a connection in its handshake response. What is exposed is the agent list, a session count, the root config and any open terminal's title; what is behind a handler is not.

Revocation and expiry come for free, which the connection token has no vocabulary for.

Clients have work to do. Neither `ahpc` nor `ahpapp` sends `authenticate` for a host-level resource today, so both need the flow before a user directory is usable from them. That is the price of this route and the reason it is worth writing down.

## Options

- **Resolve the connection token to a principal in `listen.ts`.** Zero client work, since `ahpapp` already keeps a per-host token in the Keychain and `ahpc` takes one in the URL, and identity would exist before the first frame. Rejected by the user. It is also outside the specification, so it would have no revoke, no expiry and no `-32007`, and each would have to be invented.
- **Both, with the token as the v1 and `authenticate` added after.** Offered and not chosen.
- **An external identity provider through `authorization_servers`.** A separate decision, and not this one: see [ahpd keeps its own user directory](ahpd-keeps-its-own-user-directory.md).
