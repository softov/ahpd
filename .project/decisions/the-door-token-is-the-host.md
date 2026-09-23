---
title: The door token is the host, and a person's own token is that person
status: superseded
superseded-by: decisions/the-door-is-a-door.md
date: 2026-09-23
supersedes: decisions/a-connection-token-may-carry-a-person.md
refs:
  - "[code://packages/sdk/src/listen.ts#L73-L115](../../packages/sdk/src/listen.ts#L73-L115) - `identityOf`, which admits on the deployment's token and names nobody, which is what this reverses"
  - "[code://packages/sdk/src/host.ts#L6343-L6350](../../packages/sdk/src/host.ts#L6343-L6350) - the dispatch gate, which reads the principal"
  - "[code://packages/sdk/src/host.ts#L7537-L7555](../../packages/sdk/src/host.ts#L7537-L7555) - the command gate, the second place a principal is the whole question"
  - "[code://packages/sdk/src/host.ts#L5383-L5432](../../packages/sdk/src/host.ts#L5383-L5432) - `authenticate`, which attaches and detaches a principal and must not be able to drop the door key's authority"
  - "[code://packages/sdk/src/types/host.ts#L403-L441](../../packages/sdk/src/types/host.ts#L403-L441) - `Connection`, where the door token's meaning belongs"
  - "[code://docs/USERS.md](../../docs/USERS.md) - the three ways in, which this changes the first row of"
---

## Context

The connection token is the deployment's own key. It was introduced as the answer to whether a socket may exist at all, and a user directory was added beside it so that a person's credential decides what they may do.

That left the operator's own key unable to do anything. Once a directory is configured, the host's own token admits the socket and confers no principal, so every gated command answers `-32007` and every client shows a sign-in it may not be able to complete: the reference client has no field for a pasted secret, and the phone's sheet is reached from a chip rather than from the refusal.

The operator holds the key to their own host and is locked out of it by configuring people on it. That is the wrong default, and it is the situation the door-token-as-login was made for.

## Decision

A socket admitted by the deployment's connection token is the host itself.
It may do everything: every capability, including a URI scheme no role names, because the key is the host's own and a role deliberately has no wildcard.
It is the host for the life of the socket, and signing in or out on that connection does not change it: `authenticate` still resolves a person for every other resource, and it can neither downgrade the door key nor revoke it by pushing an empty token.

A person's own connection token still resolves to that person through the directory, exactly as it does now, and `authenticate` is unchanged for a connection that is neither root nor already somebody.
A deployment with no user directory is untouched: there is no gate, so there is nothing for the door token to be root of.

## Consequences

The deployment token is now full authority, so anyone who holds it is the host. That is the cost of the operator's key working, and it is why a person who should be limited is given their own token instead of the shared one.
`ahpd user rm` cannot remove root, because root is not a record and never was: revoking the door key is rotating it or starting the daemon without it.
Root does not appear in `ahpd user list`, and the refusal messages never name it, because no capability it lacks exists to be refused.
A client that connects with the deployment token no longer needs to sign in at all, which is what makes the reference client's missing sign-in field survivable rather than fatal.

## Options

- **Leave the door token naming nobody.** Rejected: the operator's own key locked them out of their own host as soon as they configured a single person, and the clients could not complete the sign-in they were being asked for.
- **Make root a principal that `authenticate` may replace.** Rejected: signing in as a limited person, or pushing an empty token to revoke, would silently drop the operator's authority and look like the host breaking.
- **Make root a record with a role in the file.** Rejected: the key belongs to the deployment and not to a person, a role cannot cover a plugin's scheme because there is no wildcard, and deleting the record would lock the host out of itself.
