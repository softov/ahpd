---
title: A connection token may carry a person, beside the one that only opens the door
status: accepted
date: 2026-09-23
supersedes: decisions/a-person-signs-in-through-authenticate.md
refs:
  - "[code://packages/sdk/src/listen.ts#L73-L86](../../packages/sdk/src/listen.ts#L73-L86) - `allowed`, the synchronous comparison against one shared secret"
  - "[code://packages/sdk/src/types/listen.ts#L53-L63](../../packages/sdk/src/types/listen.ts#L53-L63) - `ListenOptions.token`, the door"
  - "[code://packages/sdk/src/host.ts#L4474-L4478](../../packages/sdk/src/host.ts#L4474-L4478) - `accept`, which builds a `Connection` with no principal"
  - "[code://packages/sdk/src/host.ts#L5415-L5432](../../packages/sdk/src/host.ts#L5415-L5432) - `authenticate`, where a person becomes a principal today"
  - "[code://packages/sdk/src/users.ts#L148-L162](../../packages/sdk/src/users.ts#L148-L162) - `Users.verify`, the one question a token is asked"
  - "[file:///github/externals/vscode/src/vs/sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHostActions.ts#L78-L127](file:///github/externals/vscode/src/vs/sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHostActions.ts#L78-L127) - the Add Remote Agent Host prompt takes a WebSocket URL with `?tkn=TOKEN` and carries it as the connection token"
  - "[file:///github/externals/agent-host-protocol/docs/specification/authentication.md#L88-L121](file:///github/externals/agent-host-protocol/docs/specification/authentication.md#L88-L121) - token delivery is `authenticate`, which this keeps unchanged"
---

## Context

Decision `a-person-signs-in-through-authenticate` chose the protocol's `authenticate` for a person's credential and said the connection token would not become per-user.
That is a fair reading of the specification and it leaves one client with no route at all.
VS Code acquires a token only from an authentication provider matched through `authorization_servers`, and this host is its own issuer, so there is no provider to match.
The client never offers a field for a pasted secret, and its interactive fallback is a GitHub Copilot sign-in dialog, which is the wrong issuer for this host.

There is one credential VS Code can carry today.
When a remote agent host is added, the prompt takes a WebSocket URL and keeps its `connectionToken`, and the node transports append `?tkn=`.
That token is the transport's rather than the protocol's: AHP says nothing about how a socket is admitted, and `listen.ts` reads the token from the query string or a bearer header.

## Decision

The presented connection token is resolved in two steps.
The deployment's shared token admits the socket and confers no principal, exactly as it does now.
Anything else is asked of the user directory, and a match admits the socket with that person's principal attached before the first frame.
`authenticate` is unchanged and remains the protocol's way to become a principal, so the two are distinct: the socket answers who may be here, and `authenticate` is what the protocol asks.
The shared token does not become a login; giving it a principal of its own is deferred.

## Consequences

A client that can only carry a URL token works with no plugin and no client change, because a person pastes `ws://host:port?tkn=<theirs>` where the host is added.
`ahpd user token` already mints the secret, so the directory gains a second question rather than a second store, and one `verify` answers both the door and the protocol.
The same secret does two jobs for that person: it opens the socket and it is who they are, so a leaked token is worse than a leaked door key, and per-person revocation replaces rotating one shared secret for everybody.
Removal refuses the next connection rather than the next command, because a principal already attached lives until the socket drops; the documentation has to say that rather than claim otherwise.
The secret travels in a URL, so it can reach a log, and what the daemon prints and what a client redacts become part of the work.
A connection admitted by the shared token still has no identity and is still refused by the gate, so an operator who holds only the door key signs in through `authenticate` or is given a token of their own.

## Options

- **Keep `authenticate` as the only way to become a principal.** Rejected: it is the specification's way and it leaves VS Code with no route, which is the problem this decision exists to solve.
- **Make the shared connection token a root login.** Rejected for now: one shared secret would confer every capability and the directory would stop deciding what that connection may do. Deferred rather than refused.
- **Accept an issuer's token as the connection token.** Rejected: a client obtains an issuer token only after it has connected, so there is nothing to present at the door, and a reusable third-party credential in a query string is worse than one sent through `authenticate`.
- **Ship a VS Code extension that supplies an authentication provider.** Rejected: it is a client artifact to write and distribute, and the transport already carries what the host needs.
