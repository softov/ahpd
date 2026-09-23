---
title: A host-level protected resource has no home in AHP
date: 2026-09-23
refs:
  - "[file:///github/externals/agent-host-protocol/docs/specification/authentication.md#L27-L86](file:///github/externals/agent-host-protocol/docs/specification/authentication.md#L27-L86) - discovery is per agent, and `required` answers whether that agent can work without a token"
  - "[file:///github/externals/agent-host-protocol/types/channels-root/state.ts#L36-L75](file:///github/externals/agent-host-protocol/types/channels-root/state.ts#L36-L75) - `RootState`, whose `_meta` is the only implementation-defined place a host can say anything about itself"
  - "[code://packages/sdk/src/host.ts#L2144-L2150](../../packages/sdk/src/host.ts#L2144-L2150) - `resourcesOf`, which appends this host's login to every agent because there is nowhere else to put it"
  - "[file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L47-L53](file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostAuth.ts#L47-L53) - a client that reads `required` as \"this session type needs a token\" refuses to open a session before it has tried a command"
---

AHP models authentication per agent: `AgentInfo.protectedResources` is where a requirement lives, `required` says whether that agent works without a token, and the specification explains the per-agent choice deliberately, because two agents on one server may need two different providers.

`ahpd` has a requirement that is not an agent's. The host itself decides who may call it, and a person's sign-in is required for every command regardless of which backend a session runs on. There is no host-level `protectedResources`, so the login is appended to every agent's list.

That works mechanically - `authenticate` accepts any resource the server advertised, and a client reads the list - and it has two costs.

The first is that every agent now reads as `required`, because `required` is absent-means-true and this credential is genuinely needed. A client that uses `required` to decide whether to prompt before opening a session will prompt, and one that cannot obtain a token for the host's resource will refuse to open a session at all. That is the failure that prompted the research in `client-auth-and-the-reference-client.md`.

The second is that the record is duplicated once per agent, so a host with four backends advertises the same login four times, and a client that deduplicates does so by accident rather than by design.

## What would fix it in the protocol

A host-level protected resource, beside `agents`: something like `RootState.protectedResources`, with the same `ProtectedResourceMetadata` shape, advertised once and consulted exactly as the per-agent list is.

A client would resolve it the same way - a provider matched through `authorization_servers`, a token pushed with `authenticate`, the resource identifier as the key - and `required` would mean what it means for an agent: whether this host can be used without it.

Until that exists, the honest options are the two already taken:

- advertise the login on every agent, which is what `ahpd` does, and accept that each agent reads as required;
- put it in `RootState._meta`, which the specification allows as implementation-defined metadata about the host, and accept that no client acts on it for sign-in.

Neither is a workaround to be proud of, and neither is a reason to invent an extension: the field is a protocol decision, so the note belongs upstream.
