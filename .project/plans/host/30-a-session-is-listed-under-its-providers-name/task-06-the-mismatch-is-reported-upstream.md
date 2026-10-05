---
title: The scheme and provider mismatch is reported upstream
status: doing
depends: []
layer: "upstream"
refs:
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/agent.ts - `AgentSession.provider()` returns the URI scheme
  - https://github.com/microsoft/agent-host-protocol - where the issue is filed
---

## Objective

An issue on the agent-host-protocol repository asks whether a session URI's scheme must be its provider, since `createSession` takes the channel and the provider separately and VS Code routes on the scheme.

## Files

- None in this repository.

## Steps

1. Draft the issue: what `createSession` allows, what VS Code assumes, the empty view it causes, and the question; cite only VS Code and the spec.
2. Show Softov the text in chat, and post it only after he approves the words.

## Validation

- The issue's URL is in this task's Resume.

## Resume

Draft below, both citations read on 2026-10-04 and not from memory: the spec from `@microsoft/agent-host-protocol` 1.0.0 in `node_modules`, VS Code from the checkout at `/github/externals/vscode`.

What the two sides say:

- `CreateSessionParams.channel` is documented "Session URI (client-chosen, e.g. `ahp-session:/<uuid>`)" and `provider` is a separate "Agent provider ID" (`src/types/channels-session/commands.ts`).
- `SessionMetadata.provider` carries the provider on the session itself (`src/types/channels-session/state.ts`), so the provider is available without reading the URI.
- `AgentSession.uri(provider, rawSessionId)` is documented "Creates a session URI from a provider name and raw session ID. The URI scheme is the provider name", and `AgentSession.provider()` is documented "Extracts the provider name from a session URI scheme" and returns `parsed.scheme` (`src/vs/platform/agentHost/common/agent.ts`).

So a client that follows the spec's own example and creates `ahp-session:/<uuid>` with `provider: "copilot"` produces a session VS Code files under a provider called `ahp-session`.

The draft, to be posted to microsoft/agent-host-protocol only after Softov approves the words:

```markdown
### Question: must a session URI's scheme be its provider?

`createSession` takes the session's URI and its provider as two separate fields. The spec documents `channel` as "Session URI (client-chosen, e.g. `ahp-session:/<uuid>`)" and `provider` as the agent provider ID, and `SessionSummary` carries `provider` on the session, so a host and a client can both name a session without the provider being in the URI.

VS Code reads the provider off the scheme instead. `AgentSession.provider()` is documented as extracting the provider name from a session URI's scheme and returns `parsed.scheme`, and `AgentSession.uri(provider, rawSessionId)` builds a session URI with the provider as the scheme. `AgentSession.provider()` therefore reports the scheme, whatever the host listed.

For a host that follows the spec's example, the mismatch is visible: a session created as `ahp-session:/<uuid>` with `provider: "copilot"` is listed under that URI, VS Code reads its session type as `ahp-session`, finds no harness descriptor for it, and the Agents Window opens an empty session. The same session listed after a restart under `<provider>:/<uuid>` opens correctly, so the session reads differently depending on whether the host created it in this run or found it on disk. Everything the session carries (turns, a pending approval) is there; the window just cannot match a provider to open it.

We have worked around this on the host side by publishing every session as `<provider>:/<id>` and treating the URI the client chose as an alias, so both spellings reach the same session. That is a workaround, not a fix: a client that follows the spec's example still produces a session VS Code cannot open until the host compensates.

Questions:

1. Is a session URI's scheme required to be its provider, and should the spec say so?
2. If it is not required, should a client read the provider from `SessionSummary.provider` rather than from the URI scheme?
3. If the scheme is required to be the provider, should `createSession` validate it and refuse a URI whose scheme is not the provider, rather than accepting it and reporting `ahp-session` as the session's type?
```

Two things to settle before posting: the permalink for `agent.ts` carries `832cf23c588` from this plan's refs, and the SHA could not be re-read in this build (no access to `git` under `/github/externals`), so it should be checked against the branch before the issue goes up. The second question is the one that matters most to us; the rest is context.
