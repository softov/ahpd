---
title: The scheme and provider mismatch is reported upstream
status: done
depends: []
layer: "upstream"
refs:
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/session-channel.md - the provider is not encoded in the session URI's scheme
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agent.ts#L1158-L1163 - `AgentSession.provider()` returns the URI scheme
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1735-L1745 - VS Code's host lists a session's provider from its scheme
---

## Objective

Whether a session URI's scheme must be its provider is settled against the specification and against VS Code running, and what is VS Code's to fix is written as a proposal ready to file.

## Files

- `.project/proposals/vscode-session-provider-read-from-scheme.md`
- `.project/proposals/index.md`

## Steps

1. Read what the specification says about a session URI.
2. Read where VS Code's host and client take a session's provider from.
3. Run VS Code's own agent host with a client that names a session the spec's way, and record what it answers.
4. Write the proposal for the side that is wrong, and show Softov the text before anything is filed.

## Validation

- The proposal is in `.project/proposals/` and in its index, marked not filed.

## Resume

Done on 2026-10-05; the first draft (a question to `microsoft/agent-host-protocol` asking whether the scheme must be the provider) is replaced, because the specification already answers it.

What the specification says: `docs/specification/session-channel.md` names a session `ahp-session:/<uuid>`, with the path chosen by the client, and says "The session's provider (e.g. `"copilot"`) is **not** encoded in the URI scheme, it is carried on `SessionSummary.provider`". The protocol's channels migration guide calls `<provider>:/<uuid>` the pre-channels form and tells implementations to drop `AgentSession.provider(session)` lookups and read `SessionSummary.provider` instead.

What VS Code does, read at `7516b04bc94`: `AgentSession.provider()` returns the scheme; the host's `listSessions` uses it as each row's provider; the client's `listSessions` and `root/sessionAdded` handlers drop `SessionSummary.provider` and read the scheme instead; VS Code's own clients create sessions as `<provider>:/<id>`; `ahp-session:` is handled only by a per-host alias that only the cloud sandbox host sets, and that host addresses sessions as `ahp-session` with provider `copilot`.

What VS Code does, run on 2026-10-05: `code agent host` 1.132.1 (protocol 0.9.0) on this workstation, with the Agents Window connected through `scripts/tee.mjs`, and the host's own per-connection AHP logs.
- The Agents Window sent `createSession` as `copilotcli:/7e2e1142-…` and `codex:/0ebe9f97-…`, each with the same provider; the host listed both under those URIs and providers; `ahp-session:` appeared in none of the window's frames. ahpc sent `copilotcli:/681059e9-…`.
- A probe client sent `createSession { channel: "ahp-session:/d58bdf43-…", provider: "copilotcli" }` and one turn. The host accepted it and ran the turn, announced it in `root/sessionAdded` with `provider: "copilotcli"`, and listed it in `listSessions` with `provider: "ahp-session"`.

So the mismatch is real and it is VS Code's: its own host gives a session named as the specification shows two providers. ahpd's holding of a session as `<provider>:/<id>`, with the client's URI as an alias (decision `a-session-is-held-under-its-providers-name`), is what VS Code requires, and it still sends the right `SessionSummary.provider` for a client that follows the specification; the one way it departs from the specification is renaming a URI the client chose.

Outcome, Softov, 2026-10-05: nothing is filed now. The issue is kept as the proposal [vscode-session-provider-read-from-scheme.md](../../../proposals/vscode-session-provider-read-from-scheme.md), and VS Code's next releases are watched; it is filed if the behaviour gets worse. When VS Code reads `SessionSummary.provider`, ahpd can keep the URI the client chose.
