---
title: What the reference client can and cannot do with a host-issued credential
date: 2026-09-23
refs:
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L362-L395) - agent protected resources are resolved through installed providers only"
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L777-L830](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L777-L830) - the interactive fallback runs the GitHub Copilot sign-in dialog"
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L838-L984](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L838-L984) - the RFC 8414 dynamic provider path, wired for MCP servers"
  - "[file:///github/externals/vscode/src/vs/sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHostActions.ts#L78-L127](file:///github/externals/vscode/src/vs/sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHostActions.ts#L78-L127) - Add Remote Agent Host takes a WebSocket URL and carries its `connectionToken`"
  - https://www.rfc-editor.org/rfc/rfc9728.txt - `authorization_servers` is a list of RFC 8414 issuer identifiers
  - "[file:///github/externals/agent-host-protocol/docs/specification/authentication.md#L56-L86](file:///github/externals/agent-host-protocol/docs/specification/authentication.md#L56-L86) - discovery is per agent, and `required` says whether an agent can work without a token"
---

Read 2026-09-23 against the checkout pinned at `832cf23c588`, to answer one question: what does the reference client do when a host issues its own credential instead of delegating to an OAuth authorization server.

## A self-issued credential has no route through the sign-in flow

For `AgentInfo.protectedResources` the client resolves a session with `getOrActivateProviderIdForServer` and `getSessions`, over the entries in `authorization_servers`.
Only providers that are already installed can match.
There is no field anywhere in that flow for a secret a person pastes, and the interactive fallback calls `CHAT_SETUP_ACTION_ID` with the dialog title "Sign in to use GitHub Copilot", so the one prompt it can show belongs to a different issuer.

The consequence is the failure that prompted this research: a host advertising a record whose `authorization_servers` is not a real issuer produces a `-32007` with nothing to click.
Where the advertised value names a page on `github.com`, the client may additionally resolve GitHub's provider and forward a GitHub token the host then refuses, which is a worse failure than no token because it looks like a sign-in that succeeded.

## The client has an RFC 8414 path, but only for MCP servers

`resolveMcpServerAuthentication` calls `getOrCreateProviderForMcpResource`, which fetches the authorization server's metadata and calls `createDynamicAuthenticationProvider`.
That is exactly the mechanism a specification-following host wants: any conformant issuer works without hardcoded knowledge of it, which is what `authentication.md` means by "dynamic auth providers (for enterprise IdPs) work without hardcoded knowledge of specific providers".

It is not reached for agent protected resources.
Extending the agent path to try it would make any real issuer work with no extension, and it is a change in the reference client rather than in `ahpd`.
Until then, the issuers that work with stock clients are the ones a provider is already installed for, GitHub being the one that matters here.

## The transport carries a token the client can use

Add Remote Agent Host takes a host, a `host:port`, or a WebSocket URL, and keeps a `?tkn=` query string as the connection's `connectionToken`; the node transports append the same parameter.
AHP does not define the transport, so this is the client's own door, and it is the same convention `ahpd`'s `listen.ts` reads.

That is why a per-user connection token reaches this client at all: a person pastes what `ahpd user token <id> --url` printed, and the socket is admitted.
The finding was written when that token also arrived as its owner - decision `a-connection-token-may-carry-a-person`, since superseded.
Under decision `the-door-is-a-door` the door says nobody, so the same paste needs the record's `trustToken` for the window to be that person without a sign-in flow.

## The host-level login has no home in the protocol

Discovery is per agent, and `required` answers whether *that agent* can work without a token.
A host-wide login therefore has nowhere correct to sit: advertising it on every agent, as `ahpd` does, makes every agent read as required and is the reason a client refuses to open a session before it has tried a command.
Putting it in `RootState._meta` would be honest ("implementation-defined metadata about the agent host itself") and invisible, since no client acts on it for sign-in.

The fix that does not invent anything is a host-level protected resource in AHP, raised upstream rather than worked around here.
What `ahpd` can do meanwhile is tell the truth in the record and give a client a way in that does not depend on the field: an issuer when the client has a provider for it, and `trustToken` on the record when it has none.
