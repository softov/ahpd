---
title: The door admits a socket and names nobody, and the deployment's token is still the host
status: accepted
date: 2026-09-23
supersedes: decisions/the-door-token-is-the-host.md
refs:
  - "[code://packages/sdk/src/listen.ts#L82-L124](../../packages/sdk/src/listen.ts#L82-L124) - `identityOf`, which still answers root for the deployment's token and now admits a person's token as nobody unless the record trusts it"
  - "[code://packages/sdk/src/types/listen.ts#L74-L90](../../packages/sdk/src/types/listen.ts#L74-L90) - `ListenOptions.identify` and `root`, and why `identify` may answer an arrival with no principal"
  - "[code://packages/sdk/src/users.ts#L258-L281](../../packages/sdk/src/users.ts#L258-L281) - `principalOf`, where `trusted` is the record's `trustToken` or the host default"
  - "[code://packages/sdk/src/users.ts#L130-L155](../../packages/sdk/src/users.ts#L130-L155) - `FileUserOptions.trustToken`, the host-wide default"
  - "[code://packages/server/src/main.ts#L810-L830](../../packages/server/src/main.ts#L810-L830) - the daemon's `identify`, which hands the record over only when it is trusted"
  - "[code://packages/server/src/config.ts#L60-L72](../../packages/server/src/config.ts#L60-L72) - the `trustToken` key, off unless it is written"
  - "[code://docs/USERS.md](../../docs/USERS.md) - the two layers, which this makes true rather than nominal"
---

## Context

Decision `the-door-token-is-the-host` gave a person's connection token two meanings at once: it opened the socket and it arrived as that person, so a client that can only carry a URL never had to sign in.
That was written to get the operator's own key working and it carried the person's token along with it.

It also made the door the authorization. A token in a query string ends up in a proxy log, a shell history and a screenshot, and a leaked personal token was an authenticated person for the life of the connection, with nothing asked at `authenticate` and nothing to revoke but the record.
The two layers documented in [USERS.md](../../docs/USERS.md) - the door decides whether a socket exists, `authenticate` decides who is on it - were only nominal for a personal token.

The user asked for the inversion on 2026-09-23: "Can we invert.. better security right?", and confirmed the exemption with "the deployment token exempt: yes", which is what keeps the operator's key as it was.

## Decision

A connection token other than the deployment's own opens a socket and names nobody.
`authenticate` is what authorizes, for every door and every credential, exactly as the specification says.
`identify` keeps answering whether the token opens the door at all, and its arrival carries a principal only when the directory says that token is also the person's authorization.

The deployment's token is unchanged and remains the host: a socket on it is root, every capability, never challenged.
A host with no user directory is unchanged: there is no gate, so there is nobody to name.

Trusting the token is an opt-out, in two places.
`trustToken` in the configuration (or `--trust-token`) applies to everybody, and a record's own `trustToken` decides for that one person and wins over the host.
It is off by default.
It exists for a client that can only carry a URL and cannot complete a sign-in, and for an operator who has decided the network is the boundary.

## Consequences

Default security is now the honest one: a leaked personal token opens a socket and reads what the protocol serves without a principal, and every command behind the gate answers `-32007` until the person signs in.
A deployment that wants the old behaviour writes one key, so the change is visible in its configuration rather than implied by the code.
The cost is that a client with no sign-in route needs that key: the reference client still has no field for a pasted secret, so a deployment reaching it sets `trustToken`, per record or once.
Root is untouched: `trustToken` is about a person's token, and the deployment's token was never gated on it.

## Options

- **Keep a personal token as both door and authorization.** Rejected: it is one secret doing two jobs, a URL leak is a full identity, and `authenticate` was decoration for the clients that did sign in.
- **Make it a per-client setting instead of a host setting.** Rejected: the host cannot tell a client that will sign in from one that will not, and a client that asks to be trusted is asking to be trusted by itself.
- **Keep the person's principal at the door and have `authenticate` upgrade it.** Rejected: the socket would already be that person before the credential was presented, which is the leak this removes, and a person whose roles changed would have two answers on one connection.
- **Require `authenticate` even for the deployment's token.** Rejected: the operator's own key would be challenged by the host it starts, and decision `the-door-token-is-the-host` settled why the key is root.
