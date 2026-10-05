---
title: A session named the way the spec shows it is listed under a provider called `ahp-session`
target: https://github.com/microsoft/vscode
date: 2026-10-05
refs:
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agent.ts#L1158-L1163 - `AgentSession.provider()`, which returns the URI's scheme
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1735-L1745 - `listSessions`, which names the provider from the scheme
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1646-L1674 - `createSession`, which keeps the client's URI and warns when a provider does not
  - file:///github/externals/vscode/src/vs/platform/agentHost/browser/agentHostProtocolClient.ts#L1892-L1925 - the client's `listSessions`, which drops `provider`
  - file:///github/externals/vscode/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L7557-L7590 - `_handleSessionAdded`, which drops `provider`
  - file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/remoteAgentHost/cloudSandboxConnectionCustomization.ts#L43-L80 - the per-host scheme alias only the cloud sandbox sets
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/session-channel.md - "The session's provider is not encoded in the URI scheme"
---

## Summary

The protocol says a session's provider is not in its URI: a session is `ahp-session:/<uuid>`, the client chooses that URI, and the provider is carried on `SessionSummary.provider`.
VS Code's agent host accepts a session created that way and runs it, then reports two different providers for it: the right one when it announces the session, and `ahp-session` when it lists it.

Reproduced on 2026-10-05 against `code agent host` 1.132.1, protocol 0.9.0, with one client sending:

```
createSession { channel: "ahp-session:/d58bdf43-…", provider: "copilotcli" }
dispatchAction chat/turnStarted on ahp-chat://default/<base64url of that URI>
```

The host ran the turn and sent, for the same session:

```
root/sessionAdded  { resource: "ahp-session:/d58bdf43-…", provider: "copilotcli" }
listSessions       { resource: "ahp-session:/d58bdf43-…", provider: "ahp-session" }
```

## Where it comes from

`AgentSession.provider()` returns the URI's scheme, and `listSessions` uses it as the provider of every row (`protocolServerHandler.ts:1738`), so a row's provider is whatever the scheme is.
`root/sessionAdded` is built from the provider the session was created with, which is why the two disagree.
The client does the same from its side: the `listSessions` result and `root/sessionAdded` are both turned into session records without `SessionSummary.provider` (`agentHostProtocolClient.ts:1892-1925`, `baseAgentHostSessionsProvider.ts:7557`), and the provider is read back from the scheme wherever it is needed.
VS Code's own clients never hit this, because they create sessions as `<provider>:/<id>` (the Agents Window sent `copilotcli:/…` and `codex:/…` in the same run).
`ahp-session:` is handled only through a per-host alias, and only the cloud sandbox host sets one: that host "advertises provider `copilot` but addresses sessions as `ahp-session`" (`cloudSandboxConnectionCustomization.ts:43`), which is the spec's form, so VS Code already meets a host that follows the spec and handles it by naming that host.

## Why it is worth a look

The URI that breaks it is the one the specification uses as its own example, so any client written from the spec meets it.
The protocol's channels migration guide already names the scheme-to-provider helper as the pre-channels form to remove ("remove any `AgentSession.provider(session)` lookups ... Read the provider from `SessionSummary.provider` instead"), so this reads as a migration step not yet taken for generic hosts rather than a deliberate choice.

## Suggested change

Read the provider from `SessionSummary.provider` wherever a session's provider is needed, on both the host's `listSessions` and the client's session records, and keep the scheme for addressing only.
Until then, `listSessions` could at least report the provider the session was created with, which the host already knows, so the two answers agree.

## How a sibling project handles it

The daemon in `softov/ahpd` holds every session as `<provider>:/<id>` and keeps the URI the client chose as an alias of it, so VS Code opens a session another client created (decision `a-session-is-held-under-its-providers-name`).
That works, at the cost of renaming a URI the client chose, which the protocol says is the client's.
