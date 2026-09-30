---
title: A session is held under `<provider>:/<id>`, and the name a client created it under is an alias
status: accepted
date: 2026-09-29
refs:
  - "[code://packages/sdk/src/host.ts#L559-L573](../../packages/sdk/src/host.ts#L559-L573) - `named`, which checks the session URI a client sent"
  - "[code://packages/sdk/src/host.ts#L1121-L1131](../../packages/sdk/src/host.ts#L1121-L1131) - `names` and `nameOf`, which already publish a listed session as `<provider>:/<id>`"
  - "[code://packages/sdk/src/host.ts#L3828-L3835](../../packages/sdk/src/host.ts#L3828-L3835) - `listing`, which names a session found on a backend's disk `<provider>:/<id>`"
  - "[code://packages/sdk/src/host.ts#L1098-L1120](../../packages/sdk/src/host.ts#L1098-L1120) - `heldAs`, which resolves any spelling of a session to the one held"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/session-channel.md - the provider is not encoded in the session URI's scheme
---

## Context

The protocol says a session URI is chosen by the client and does not carry the provider: `ahp-session:/<uuid>` with the provider on `SessionSummary.provider`.
VS Code does the opposite: `AgentSession.provider()` returns the URI's scheme, and the handler that opens a session rebuilds its URI as `<its provider>:/<id>` from the id alone (`agentHostSessionHandler.ts` `_resolveSessionUri`, on VS Code `main` at `ac05bdfe`).
A session ahpapp created as `ahp-session:/39c2…` was listed by ahpd under that name, VS Code filed it under a provider called `ahp-session` (`No harness descriptor found for session type …-ahp-session`), and the Agents Window showed an empty session with no approval.
The same session listed after a restart came from the Claude catalogue as `claude:/39c2…`, and VS Code opened it.
So ahpd already names a session two ways depending on whether it was created by a client in this run or found on disk, and only one of them works in VS Code.

## Decision

ahpd holds every session under `<provider>:/<id>`, where `<id>` is the id inside the URI the client sent and `<provider>` is the provider it asked for.
That is the name in `listSessions`, in `root/sessionAdded`, `root/sessionSummaryChanged` and `root/sessionRemoved`, and in every URI built from the session: chats, changesets, annotations, edits.
The URI the client created the session under stays a name for it: any request on it resolves to the held session, and a connection that subscribes under it is answered in that spelling.

Source: Softov, 2026-09-29, asked whether the fix is the client naming by provider, ahpd aliasing, or an upstream report: "I thinking supporting aliases also is the correct approach to avoid future problems."
Holding the provider's name and aliasing the client's, rather than the other way round, is `(defaulted: the restart path already holds a resumed session under nameOf(id), so both paths end up the same)`.

## Consequences

A session reads the same before and after a restart, so VS Code opens a session another client created.
A client that created a session as `ahp-session:/<id>` sees it listed as `<provider>:/<id>` and has to match rows by id, which it already must for any session it resumed after a restart.
The host no longer echoes the client's session URI as the session's key, and `named` says the client names the id and the host the scheme.
Persisted chat titles are keyed by a chat URI that embeds the old spelling, so they need a lookup that survives the rename.

## Options

- Keep the client's URI as the key and respell only what is listed and announced: lost, because every other URI built from the session (chats, changesets, annotations, `_meta.subagentChatUri`) would stay in the client's spelling and each outward path would need its own respelling, and a restart would still re-key the session under the other name.
- Have ahpapp and ahpc create sessions as `<provider>:/<uuid>`: works today with no ahpd change, but any client that follows the protocol's own example still produces a session VS Code cannot open.
- Report it to VS Code and change nothing here: the spec is on ahpd's side, but the Agents Window stays broken until VS Code changes, and nothing says it will.
